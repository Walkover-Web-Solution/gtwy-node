// Backend proxy for the Hugging Face Hub API — resolves which inference task
// (chat vs. embeddings vs. ...) and which providers serve a given HF model, so
// the frontend never calls huggingface.co directly (per
// docs/huggingface-frontend-integration.md §5 in AI-middleware-python: keeps a
// future HF token for gated/private models server-side, and matches the pattern
// every other "list models for a service" flow in this product already uses).

const HF_HUB_URL = "https://huggingface.co";

// Mirrors HuggingFaceModelResolver.js's SUPPORTED_HF_TASKS — kept here too so the
// backend can also short-circuit before making the HF call is wasted on a task
// that can't be saved anyway (single source of truth would be nicer; duplicated
// for now since frontend/backend are separate repos with no shared package).
const SUPPORTED_HF_TASKS = new Set(["conversational", "text-generation", "image-text-to-text"]);

const searchHuggingFaceModels = async (req, res, next) => {
  const { query, limit = 20 } = req.query;

  if (!query || !query.trim()) {
    res.locals = { success: true, models: [] };
    req.statusCode = 200;
    return next();
  }

  try {
    const url = `${HF_HUB_URL}/api/models?search=${encodeURIComponent(query.trim())}&limit=${encodeURIComponent(limit)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    const models = Array.isArray(data) ? data.map((m) => ({ modelId: m.id || m.modelId, pipelineTag: m.pipeline_tag || null })) : [];

    res.locals = { success: true, models };
    req.statusCode = 200;
    return next();
  } catch (error) {
    res.locals = { success: false, error: error.message };
    req.statusCode = 502;
    return next();
  }
};

const getHuggingFaceModelProviders = async (req, res, next) => {
  const { model } = req.query;

  if (!model || !model.trim()) {
    res.locals = { success: false, error: "model is required" };
    req.statusCode = 400;
    return next();
  }

  try {
    const modelId = model.trim();
    const url = `${HF_HUB_URL}/api/models/${modelId}?expand[]=inferenceProviderMapping&expand[]=pipeline_tag`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    const providerMapping = data.inferenceProviderMapping || {};
    const providers = Object.entries(providerMapping)
      .filter(([, info]) => info?.status === "live" || info?.status === "staging")
      .map(([provider, info]) => ({ provider, task: info?.task, status: info?.status }));

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
  } catch (error) {
    res.locals = { success: false, error: error.message };
    req.statusCode = 502;
    return next();
  }
};

export default {
  searchHuggingFaceModels,
  getHuggingFaceModelProviders
};
