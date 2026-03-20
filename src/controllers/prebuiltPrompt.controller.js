import prebuiltPromptDbService from "../db_services/prebuiltPrompt.service.js";
import { getAiMiddlewareAgentData } from "../services/utils/aiCall.utils.js";
import { bridge_ids, prebuilt_prompt_bridge_id } from "../configs/constant.js";

const getPrebuiltPrompts = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const prebuiltPrompts = await prebuiltPromptDbService.getPrebuiltPromptsService(org_id);

  const existingPromptIds = new Set();
  prebuiltPrompts.forEach((prompt) => {
    Object.keys(prompt).forEach((key) => existingPromptIds.add(key));
  });

  for (const prebuiltPromptId of prebuilt_prompt_bridge_id) {
    if (!existingPromptIds.has(prebuiltPromptId)) {
      try {
        const bridgePrompt = await getAiMiddlewareAgentData(bridge_ids[prebuiltPromptId]);
        if (bridgePrompt?.agent?.configuration?.prompt) {
          prebuiltPrompts.push({ [prebuiltPromptId]: bridgePrompt.agent.configuration.prompt });
        }
      } catch (error) {
        console.warn(`Failed to fetch bridge prompt ${prebuiltPromptId}: ${error.message}`);
        continue;
      }
    }
  }

  res.locals = {
    success: true,
    message: "Prebuilt prompts retrieved successfully",
    data: prebuiltPrompts
  };
  req.statusCode = 200;
  return next();
};

const updatePrebuiltPrompt = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const body = req.body;
  const prompt_id = Object.keys(body)[0];
  const prompt_text = body[prompt_id];

  const updatedPrompt = await prebuiltPromptDbService.updatePrebuiltPromptService(org_id, prompt_id, {
    prompt: prompt_text
  });

  res.locals = {
    success: true,
    message: "Prebuilt prompt updated successfully",
    data: updatedPrompt
  };
  req.statusCode = 200;
  return next();
};

const resetPrebuiltPrompts = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const { prompt_id } = req.body;

  const bridge_id = bridge_ids[prompt_id];
  const bridgePrompt = await getAiMiddlewareAgentData(bridge_id);

  if (bridgePrompt?.agent?.configuration?.prompt) {
    const originalPrompt = bridgePrompt.agent.configuration.prompt;
    const updatedPrompt = await prebuiltPromptDbService.updatePrebuiltPromptService(org_id, prompt_id, {
      prompt: originalPrompt
    });

    res.locals = {
      success: true,
      message: `Successfully reset ${prompt_id} to original value`,
      data: updatedPrompt
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = { success: false, message: "Failed to fetch original prompt from bridge configuration" };
    req.statusCode = 404;
    return next();
  }
};

const getSpecificPrebuiltPrompt = async (req, res, next) => {
  const { prompt_key } = req.params;
  const org_id = req.profile.org.id;

  const specificPrompt = await prebuiltPromptDbService.getSpecificPrebuiltPrompt(org_id, prompt_key);

  res.locals = {
    success: true,
    message: `Retrieved prompt '${prompt_key}' successfully`,
    data: specificPrompt
  };
  req.statusCode = 200;
  return next();
};

export default {
  getPrebuiltPrompts,
  updatePrebuiltPrompt,
  resetPrebuiltPrompts,
  getSpecificPrebuiltPrompt
};
