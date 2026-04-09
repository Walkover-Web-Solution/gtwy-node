/**
 * Model validation utilities for checking if models are supported by various services
 */
import axios from "axios";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

/**
 * Validates if a model is supported by OpenRouter
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateOpenRouterModel(modelName) {
  try {
    const response = await axios.get("https://openrouter.ai/api/v1/models");

    if (response.status !== 200) {
      console.error("Failed to fetch models from OpenRouter:", response.status);
      return false;
    }

    // Check if the model exists in the response data
    const models = response.data.data || [];
    return models.some((model) => model.id === modelName);
  } catch (error) {
    console.error("Error validating OpenRouter model:", error.message);
    return false;
  }
}

/**
 * Validates if a model is supported by Anthropic
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateAnthropicModel(modelName) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const response = await axios.get("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    });

    if (response.status !== 200) {
      console.error("Failed to fetch models from Anthropic:", response.status);
      return false;
    }

    // Check if the model exists in the response data
    const models = response.data.data || [];
    return models.some((model) => model.id === modelName);
  } catch (error) {
    console.error("Error validating Anthropic model:", error.message);
    return false;
  }
}

/**
 * Validates if a model is supported by Mistral
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateMistralModel(modelName) {
  try {
    const apiKey = process.env.MISTRAL_API_KEY;

    const response = await axios.get("https://api.mistral.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (response.status !== 200) {
      console.error("Failed to fetch models from Mistral:", response.status);
      return false;
    }

    // Check if the model exists in the response data
    const models = response.data.data || [];
    return models.some((model) => model.id === modelName || model.aliases?.includes(modelName));
  } catch (error) {
    console.error("Error validating Mistral model:", error.message);
    return false;
  }
}

/**
 * Validates if a model is supported by Groq
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateGroqModel(modelName) {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    const response = await axios.get("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (response.status !== 200) {
      console.error("Failed to fetch models from Groq:", response.status);
      return false;
    }

    // Check if the model exists in the response data
    const models = response.data.data || [];
    return models.some((model) => model.id === modelName);
  } catch (error) {
    console.error("Error validating Groq model:", error.message);
    return false;
  }
}

/**
 * Validates if a model is supported by OpenAI
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateOpenAIModel(modelName) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    const response = await axios.get("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (response.status !== 200) {
      console.error("Failed to fetch models from OpenAI:", response.status);
      return false;
    }

    // Check if the model exists in the response data
    const models = response.data.data || [];
    return models.some((model) => model.id === modelName);
  } catch (error) {
    console.error("Error validating OpenAI model:", error.message);
    return false;
  }
}

/**
 * Validates if a model is supported by Deepgram
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateDeepgramModel(modelName) {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      console.error("Missing DEEPGRAM_API_KEY for Deepgram model validation");
      return false;
    }

    const response = await axios.get("https://api.deepgram.com/v1/models", {
      headers: {
        Authorization: `Token ${apiKey}`
      }
    });

    if (response.status !== 200) {
      console.error("Failed to fetch models from Deepgram:", response.status);
      return false;
    }

    const sttModels = response.data?.stt || [];
    const normalizedModelName = modelName.toLowerCase();

    return sttModels.some((model) => {
      const architecture = model.architecture?.toLowerCase();
      const canonicalName = model.canonical_name?.toLowerCase();
      const name = model.name?.toLowerCase();
      return architecture === normalizedModelName || canonicalName === normalizedModelName || name === normalizedModelName;
    });
  } catch (error) {
    console.error("Error validating Deepgram model:", error.message);
    return false;
  }
}

/**
 * Validates if a model is supported by a specific service
 * @param {string} service - The service name (e.g., 'open_router', 'anthropic', 'openai')
 * @param {string} modelName - The model name to validate
 * @returns {Promise<boolean>} - True if model is supported, false otherwise
 */
async function validateModel(service, modelName) {
  if (!service || !modelName) {
    return false;
  }

  switch (service.toLowerCase()) {
    case "open_router":
      return await validateOpenRouterModel(modelName);
    case "anthropic":
      return await validateAnthropicModel(modelName);
    case "openai":
    case "openai_response":
      return await validateOpenAIModel(modelName);
    case "groq":
      return await validateGroqModel(modelName);
    case "mistral":
      return await validateMistralModel(modelName);
    case "deepgram":
      return await validateDeepgramModel(modelName);
    default:
      console.warn(`No validation method available for service: ${service}`);
      return true; // Default to true for services without validation
  }
}

export {
  validateModel,
  validateOpenRouterModel,
  validateAnthropicModel,
  validateOpenAIModel,
  validateGroqModel,
  validateMistralModel,
  validateDeepgramModel
};
