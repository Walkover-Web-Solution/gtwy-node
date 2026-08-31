/**
 * Model validation utilities for checking if models are supported by various services
 */
import axios from "axios";
import dotenv from "dotenv";
import { getBaseUrl } from "./loadServicesRegistry.js";

// Load environment variables
dotenv.config();

// Mapping of service names to their API key environment variable names
const API_KEY_ENV_MAP = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  minimax: "MINIMAX_API_KEY",
  grok: "GROK_API_KEY",
  gemini: "GEMINI_API_KEY"
};

// Services that require special header formats
const SPECIAL_HEADERS = {
  anthropic: (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  }),
  deepgram: (apiKey) => ({
    Authorization: `Token ${apiKey}`
  })
};

/**
 * Common validation function that uses base_url from DB and API key from env
 * @param {string} service - The service name
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateModelCommon(service, modelName) {
  try {
    const baseUrl = getBaseUrl(service);
    if (!baseUrl) {
      console.error(`No base_url found for service: ${service}`);
      return false;
    }

    const envKey = API_KEY_ENV_MAP[service];
    const apiKey = envKey ? process.env[envKey] : null;

    // Build headers
    let headers = { "Content-Type": "application/json" };
    if (apiKey) {
      if (SPECIAL_HEADERS[service]) {
        headers = { ...headers, ...SPECIAL_HEADERS[service](apiKey) };
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    const modelsEndpoint = `${baseUrl}/models`;
    const response = await axios.get(modelsEndpoint, { headers });

    if (response.status !== 200) {
      console.error(`Failed to fetch models from ${service}:`, response.status);
      return false;
    }

    // Handle different response formats
    const models = response.data.data || [];
    const normalizedModelName = modelName.toLowerCase();

    // Special handling for Deepgram which has a different response structure
    if (service === "deepgram") {
      const sttModels = response.data?.stt || [];
      return sttModels.some((model) => {
        const architecture = model.architecture?.toLowerCase();
        const canonicalName = model.canonical_name?.toLowerCase();
        const name = model.name?.toLowerCase();
        return architecture === normalizedModelName || canonicalName === normalizedModelName || name === normalizedModelName;
      });
    }

    // Special handling for Mistral which has aliases
    if (service === "mistral") {
      return models.some((model) => model.id === modelName || model.aliases?.includes(modelName));
    }

    // Standard OpenAI-compatible format
    return models.some((model) => model.id === modelName);
  } catch (error) {
    console.error(`Error validating ${service} model:`, error.message);
    return false;
  }
}

/**
 * Main validation function that dispatches to the common validator
 * @param {string} service - The service name
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateModel(service, modelName) {
  if (!service || !modelName) {
    return false;
  }

  // Services that don't require API key validation (public endpoints)
  const publicServices = ["open_router", "neev_cloud"];

  if (publicServices.includes(service)) {
    return await validateModelCommon(service, modelName);
  }

  // Services that require API key
  const apiKeyEnv = API_KEY_ENV_MAP[service];
  if (!apiKeyEnv || !process.env[apiKeyEnv]) {
    console.warn(`Missing ${apiKeyEnv} for ${service} model validation, skipping validation`);
    return true; // Allow if API key is not configured
  }

  return await validateModelCommon(service, modelName);
}

export { validateModel, validateModelCommon };
