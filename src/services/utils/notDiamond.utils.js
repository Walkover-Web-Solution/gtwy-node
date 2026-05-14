import NotDiamond from "notdiamond";
import axios from "axios";

const NOT_DIAMOND_MODELS_URL = "https://api.notdiamond.ai/v2/models";

const toInternalProviderName = (provider) => (provider === "google" ? "gemini" : provider);
const toNotDiamondProviderName = (provider) => (provider === "gemini" ? "google" : provider);

let supportedModelsCache = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetches and caches the list of models supported by Not Diamond.
 * Returns a Set of "provider:model" strings for O(1) lookup.
 */
const getSupportedModelSet = async () => {
  const now = Date.now();
  if (supportedModelsCache && now < cacheExpiresAt) {
    return supportedModelsCache;
  }

  try {
    const { data } = await axios.get(NOT_DIAMOND_MODELS_URL);
    const modelSet = new Set((data.models || []).map(({ provider, model }) => `${toInternalProviderName(provider)}:${model}`));

    supportedModelsCache = modelSet;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return modelSet;
  } catch (err) {
    console.error("Failed to fetch NotDiamond supported models:", err.message);
    return supportedModelsCache ?? new Set();
  }
};

/**
 * Selects the best model for a given context using the Not Diamond router.
 * Filters llmProviders to only include models supported by Not Diamond.
 *
 * @param {string} systemContent - Stringified JSON containing agent context (prompt, tools, etc.)
 * @param {Array<{provider: string, model: string}>} llmProviders - Available provider/model pairs to route between
 * @returns {Promise<{model: string, service: string, session_id: string}>}
 */
const selectBestModel = async (systemContent, llmProviders) => {
  const supportedModels = await getSupportedModelSet();

  const eligibleProviders = llmProviders
    .filter(({ provider, model }) => supportedModels.has(`${toInternalProviderName(provider)}:${model}`))
    .map(({ provider, model }) => ({
      provider: toNotDiamondProviderName(provider),
      model
    }));

  if (eligibleProviders.length === 0) {
    throw new Error("None of the available models are supported by Not Diamond.");
  }

  const client = new NotDiamond({ apiKey: process.env.NOT_DIAMOND_API_KEY });

  const result = await client.modelRouter.selectModel({
    messages: [{ role: "system", content: systemContent }],
    llm_providers: eligibleProviders
  });

  // The SDK may return the selected provider under different keys depending on version
  const providerInfo = result.provider ?? result.providers?.[0] ?? result.llm_providers?.[0];

  if (!providerInfo) {
    throw new Error(`Not Diamond returned an unexpected response shape: ${JSON.stringify(result)}`);
  }

  return {
    model: providerInfo.model,
    service: toInternalProviderName(providerInfo.provider),
    session_id: result.session_id ?? result.sessionId
  };
};

export { selectBestModel, getSupportedModelSet };
