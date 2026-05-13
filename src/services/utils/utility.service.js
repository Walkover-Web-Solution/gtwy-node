import jwt from "jsonwebtoken";
import { nanoid, customAlphabet } from "nanoid";
import crypto from "crypto";
import axios from "axios";
import { callAiMiddleware } from "./aiCall.utils.js";
import prebuiltPromptDbService from "../../db_services/prebuiltPrompt.service.js";

const alphabetSet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
// const basicAuthServices = require('../db_services/basic_auth_db_service.js')

// encryption decryption service
const algorithm = "aes-256-cbc";
const secret_key = process.env.ENCRYPTION_SECRET_KEY;
const secret_iv = process.env.ENCRYPTION_SECRET_IV;

function generateIdentifier(length = 12, prefix = "", includeNumber = true) {
  const alphabet = includeNumber ? alphabetSet : alphabetSet.slice(0, alphabetSet.length - 10);
  if (alphabet) {
    const custom_nanoid = customAlphabet(alphabet, length);
    return `${prefix}${custom_nanoid()}`;
  }
  return `${prefix}${nanoid(length)}`;
}

function encrypt(text) {
  const { encryptionKey, iv } = generateEncryption();
  const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

function decrypt(encryptedText) {
  const { encryptionKey, iv } = generateEncryption();
  const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher?.final("utf8");
  return decrypted;
}

function generateEncryption() {
  const encryptionKey = crypto.createHash("sha512").update(secret_key).digest("hex").substring(0, 32);

  const iv = crypto.createHash("sha512").update(secret_iv).digest("hex").substring(0, 16);

  return { encryptionKey, iv };
}

function generateIdForOpenAiFunctionCall(prefix = "call_", length = 26) {
  // Define possible characters (lowercase, uppercase, digits)
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let randomId = "";

  // Randomly choose characters to form the ID
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    randomId += characters[randomIndex];
  }

  // Return the ID with the prefix
  return prefix + randomId;
}

function encryptString(input) {
  input = input?.toString();
  const specialCharMap = {
    "!": "A",
    "@": "B",
    "#": "C",
    $: "D",
    "%": "E",
    "^": "F",
    "&": "G",
    "*": "H",
    "(": "I",
    ")": "J",
    "-": "K",
    _: "L",
    "=": "M",
    "+": "N",
    "[": "O",
    "]": "P",
    "{": "Q",
    "}": "R",
    ";": "S",
    ":": "T",
    "'": "U",
    '"': "V",
    ",": "W",
    ".": "X",
    "/": "Y",
    "?": "Z",
    "<": "AA",
    ">": "AAA",
    "|": "LLL"
  };
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specialChars = Object.keys(specialCharMap).map(escapeRegExp).join("");
  const regex = new RegExp(`[${specialChars}]`, "g");
  return input.toUpperCase().replace(regex, (match) => specialCharMap[match] || match);
}

function objectToQueryParams(obj) {
  return Object.keys(obj)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`)
    .join("&");
}

async function sendAlert(message, error, bridgeId, orgId, channelId) {
  try {
    // Old webhook URL (for safety): https://flow.sokt.io/func/scriSmH2QaBH
    await axios.post("https://flow.sokt.io/func/scri7hBRX0Y5", {
      channelId: channelId,
      error: {
        details: {
          alert: message,
          error_message: error.toString()
        },
        bridge_id: bridgeId,
        org_id: orgId
      }
    });
    return true;
  } catch (err) {
    console.error("Error sending alert", err);
    return false;
  }
}

function reportLoginFailure(type, token, reason) {
  if (!type) return;
  axios
    .post("https://flow.sokt.io/func/scrimCFAKPWg", {
      type,
      token,
      reason
    })
    .catch((err) => {
      const message = err?.message || err;
      console.error("Error reporting login failure", message);
    });
}

function convertAIConversation(conversation) {
  for (let message of conversation) {
    if (message["role"] === "tools_call") {
      message["content"] = message["content"].map((toolCall) => {
        return Object.values(toolCall);
      });
    }
  }
}

async function sendResponse(response_format, data, variables = {}) {
  const data_to_send = {
    response: data
  };

  switch (response_format.type) {
    case "RTLayer":
      return await sendMessage(response_format.cred, data_to_send);
    case "webhook":
      data_to_send.variables = variables;
      return await sendRequest(
        response_format.cred.url,
        data_to_send,
        "POST",
        response_format.cred.headers || { "Content-Type": "application/json" }
      );
  }
}

async function sendMessage(cred, data) {
  //send message to rtlayer
  try {
    const response = await fetch(`https://api.rtlayer.com/message?apiKey=${cred.apikey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...cred,
        message: JSON.stringify(data)
      })
    });
    return response;
  } catch (error) {
    throw new Error(`send message error=>, ${error.toString()}`);
  }
}

async function sendRequest(url, data, method, headers) {
  //send message to webhook
  try {
    const response = await fetch(url, {
      method: method,
      headers: headers,
      body: JSON.stringify(data)
    });
    return response.json();
  } catch (error) {
    throw new Error(`Unexpected error: ${url}, ${error.toString()}`);
  }
}

function generateAuthToken(user, org, extraDetails = {}, options = {}) {
  const { expiresInSeconds } = options;
  // eslint-disable-next-line no-unused-vars
  const { exp: _exp, iat: _iat, ...safeExtraDetails } = extraDetails || {};
  const signOptions = expiresInSeconds ? { expiresIn: Math.max(1, expiresInSeconds) } : { expiresIn: "48h" };

  return jwt.sign(
    {
      user,
      org,
      ...safeExtraDetails
    },
    process.env.SecretKey,
    signOptions
  );
}

const executeAiOperation = async (req, org_id, config) => {
  if (config.handler) {
    return await config.handler(req, org_id);
  }
  const context = config.getContext ? await config.getContext(req, org_id) : {};
  const prompt = config.getPrompt ? config.getPrompt(context) : "";

  let configuration = null;
  if (config.prebuiltKey) {
    const updated_prompt = await prebuiltPromptDbService.getSpecificPrebuiltPrompt(org_id, config.prebuiltKey);
    if (updated_prompt && updated_prompt[config.prebuiltKey]) {
      configuration = { prompt: updated_prompt[config.prebuiltKey] };
    }
  }

  const variables = config.getVariables ? config.getVariables(req, context) : {};
  const userMessage = config.getMessage ? config.getMessage(req, context) : prompt;
  const thread_id = req.body.thread_id;

  const aiResult = await callAiMiddleware(userMessage, config.bridgeIdConst, variables, configuration, "text", thread_id);

  if (config.postProcess) {
    return await config.postProcess(aiResult, req, context);
  }

  return {
    success: true,
    message: config.successMessage,
    result: aiResult
  };
};

export {
  generateIdentifier,
  encrypt,
  decrypt,
  generateIdForOpenAiFunctionCall,
  encryptString,
  objectToQueryParams,
  sendAlert,
  convertAIConversation,
  sendResponse,
  generateAuthToken,
  executeAiOperation,
  reportLoginFailure
};
