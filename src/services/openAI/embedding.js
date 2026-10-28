import { createEmbeddings } from "./runModel.js";
const embeddings = async (configuration, apikey) => {
  try {
    const { success, response, error } = await createEmbeddings(configuration, apikey);
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
    console.error("common error=>", error);
    return;
  }
};
export { embeddings };
