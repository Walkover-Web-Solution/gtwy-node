import { storeInCache } from "../cache_service/index.js";
import { redis_keys } from "../configs/constant.js";

const HF_HUB_URL = "https://huggingface.co";
const HF_ROUTER_URL = "https://router.huggingface.co/v1";
const HF_PRICE_CACHE_TTL = 7 * 24 * 60 * 60;
const SUPPORTED_HF_TASKS = new Set(["conversational", "text-generation", "image-text-to-text"]);

const fetchAndCacheHuggingFaceProviderPricing = async (modelId) => {
  const pricingByProvider = {};
  try {
    const url = `${HF_ROUTER_URL}/models/${modelId}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    const providers = data?.data?.providers || [];

    for (const providerInfo of providers) {
      if (!providerInfo?.pricing) continue;
      const { input, output } = providerInfo.pricing;
      pricingByProvider[providerInfo.provider] = { input_cost: input, output_cost: output };

      await storeInCache(
        `${redis_keys.huggingface_model_price_}${modelId}_${providerInfo.provider}`,
        { input_cost: input, output_cost: output },
        HF_PRICE_CACHE_TTL
      );
    }
  } catch (error) {
    console.error(`Error fetching Hugging Face provider pricing for ${modelId}:`, error.message);
  }
  return pricingByProvider;
};

const getHuggingFaceModelProviders = async (req, res, next) => {
  const { model } = req.query;

  const modelId = model.trim();
  const url = `${HF_HUB_URL}/api/models/${modelId}?expand[]=inferenceProviderMapping&expand[]=pipeline_tag`;
  const response = await fetch(url);
  if (!response.ok) {
    res.locals = { success: false, error: `HTTP error! Status: ${response.status}` };
    req.statusCode = 502;
    return next();
  }
  const data = await response.json();
  const providerMapping = data.inferenceProviderMapping || {};
  const pricingByProvider = await fetchAndCacheHuggingFaceProviderPricing(modelId);

  const providers = Object.entries(providerMapping)
    .filter(([provider, info]) => (info?.status === "live" || info?.status === "staging") && pricingByProvider[provider])
    .map(([provider, info]) => ({ provider, task: info?.task, status: info?.status, pricing: pricingByProvider[provider] }));

  const pipelineTag = data.pipeline_tag || null;

  res.locals = {
    success: true,
    modelId,
    pipelineTag,
    isTaskSupported: SUPPORTED_HF_TASKS.has(pipelineTag),
    providers
  };
  req.statusCode = 200;
  return next();
};

export default {
  getHuggingFaceModelProviders
};
