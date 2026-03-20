import crypto from "crypto";
import jwt from "jsonwebtoken";

class Helper {
  static encrypt(text) {
    const algorithm = process.env.ALGORITHM;
    const iv = crypto.createHash("sha512").update(process.env.Secret_IV).digest("hex").substring(0, 16);
    const key = crypto.createHash("sha512").update(process.env.Encreaption_key).digest("hex").substring(0, 32);
    let cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
  }
  static decrypt(encryptedText) {
    let token = null;
    const encryptionKey = process.env.Encreaption_key;
    const secretIv = process.env.Secret_IV;

    const iv = crypto.createHash("sha512").update(secretIv).digest("hex").substring(0, 16);
    const key = crypto.createHash("sha512").update(encryptionKey).digest("hex").substring(0, 32);

    const encryptedTextBytes = Buffer.from(encryptedText, "hex");
    try {
      const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
      let decryptedBytes = Buffer.concat([decipher.update(encryptedTextBytes), decipher.final()]);
      token = decryptedBytes.toString("utf8");
    } catch {
      const decipher = crypto.createDecipheriv("aes-256-cfb", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
      let decryptedBytes = Buffer.concat([decipher.update(encryptedTextBytes), decipher.final()]);
      token = decryptedBytes.toString("utf8");
    }
    return token;
  }
  static maskApiKey = (key) => {
    if (!key) return "";
    if (key.length > 6) return key.slice(0, 3) + "*".repeat(9) + key.slice(-3);
    return key;
  };

  static parseJson = (jsonString) => {
    try {
      return { success: true, json: JSON.parse(jsonString) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  static findVariablesInString(text) {
    const regex = /{{(.*?)}}/g;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }

  static async responseMiddlewareForBridge(service, response) {
    // Simplified response middleware
    return response;
  }

  static traverseBody(body, path = [], paths = [], fields = {}, required_params = []) {
    if (!body) {
      return { paths, fields, required_params };
    }

    for (const key in body) {
      const value = body[key];
      const currentPath = [...path, key];

      if (path.length === 0) {
        if (!fields[key]) {
          fields[key] = {
            description: "",
            type: "object",
            enum: [],
            required_params: [],
            parameter: {}
          };
        }
      }

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        if (path.length > 0) {
          let parentObj = fields[path[0]];
          for (let i = 1; i < path.length; i++) {
            parentObj = parentObj.parameter[path[i]];
          }

          if (!parentObj.required_params.includes(key)) {
            parentObj.required_params.push(key);
          }

          if (!parentObj.parameter[key]) {
            parentObj.parameter[key] = {
              description: "",
              type: "object",
              enum: [],
              required_params: [],
              parameter: {}
            };
          }
        }
        Helper.traverseBody(value, currentPath, paths, fields, required_params);
      } else if (value === "your_value_here") {
        paths.push(currentPath.join("."));
        if (!required_params.includes(key)) {
          required_params.push(key);
        }

        if (path.length > 0) {
          let parentObj = fields[path[0]];
          for (let i = 1; i < path.length; i++) {
            parentObj = parentObj.parameter[path[i]];
          }

          if (!parentObj.required_params.includes(key)) {
            parentObj.required_params.push(key);
          }

          parentObj.parameter[key] = {
            description: "",
            type: "string",
            enum: [],
            required_params: [],
            parameter: {}
          };
        } else {
          fields[key] = {
            description: "",
            type: "string",
            enum: [],
            required_params: [],
            parameter: {}
          };
        }
      }
    }

    return { paths, fields, required_params };
  }

  /**
   * Transforms fields structure by normalizing each field's properties
   * and replacing 'required' with 'required_params'.
   * @param {Object} fields - The fields object to transform
   * @returns {Object} Transformed fields object with normalized structure, or {} if input is invalid
   */

  static transformFieldsStructure(props) {
    if (!props || typeof props !== "object") return {};
    const transformed = {};
    for (const [key, val] of Object.entries(props)) {
      if (val === null) {
        transformed[key] = { description: "", type: "string", enum: [], required_params: [], parameter: {} };
        continue;
      }
      transformed[key] = {
        description: val.description || "",
        type: val.type || "string",
        enum: val.enum || [],
        // Filters required array to only include keys that exist in transformed fields
        required_params: Array.isArray(val.required) ? val.required : [],
        parameter:
          val.properties && typeof val.properties === "object" && Object.keys(val.properties).length > 0
            ? Helper.transformFieldsStructure(val.properties)
            : {}
      };
    }
    return transformed;
  }

  static generate_token(payload, accesskey) {
    return jwt.sign(payload, accesskey);
  }

  static makeFunctionName(name) {
    if (!name) return "";
    return name.replace(/[^a-zA-Z0-9_-]/g, "");
  }
}
export default Helper;
