import { runModel } from "./runModel.js";

const chats = async (configuration, apikey) => {
  try {
    const { success, response, error } = await runModel(configuration, true, apikey);
    if (!success) {
      return {
        success: false,
        error: error
      };
    }
    return {
      success: true,
      modelResponse: response
    };
  } catch (error) {
    console.error("chats error=>", error);
    return {
      success: false,
      error: error.message
    };
  }
};
export { chats };
