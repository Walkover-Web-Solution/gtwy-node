import OpenAIInitializer from "./openaiInitializer.service.js";
const runModel = async (configuration, chat = true, apiKey) => {
  try {
    const OpenAIConfig = new OpenAIInitializer(apiKey);
    const openAI = OpenAIConfig.getOpenAIService();
    let response;
    if (chat) {
      response = await openAI.chat.completions.create({
        ...configuration
      });
      return {
        success: true,
        response: response
      };
    }
    response = await openAI.completions.create({
      ...configuration
    });
    return {
      success: true,
      response: response
    };
  } catch (error) {
    console.error("runmodel error=>", error);
    return {
      success: false,
      error: error.message
    };
  }
};
const createEmbeddings = async (configuration, apiKey) => {
  try {
    const OpenAIConfig = new OpenAIInitializer(apiKey);
    const openAI = OpenAIConfig.getOpenAIService();
    const response = await openAI.embeddings.create({
      ...configuration
    });
    return {
      success: true,
      response: response
    };
  } catch (error) {
    console.error("runmodel error=>", error);
    return {
      success: false,
      error: error.message
    };
  }
};
export { runModel, createEmbeddings };
