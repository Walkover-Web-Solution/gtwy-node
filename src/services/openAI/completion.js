import { runModel } from "./runModel.js";
const completion = async (configuration, apikey) => {
  try {
    const { success, response, error } = await runModel(configuration, false, apikey);
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
    return {
      success: false,
      error: error.message
    };
  }
};

// const a=async ()=>{
//     const response=await common({model:"gpt-4",prompt:"you are joke generator in user language and topic",user:"generate a joke on human in hindi"},"");
//     console.log("response=>",JSON.stringify(response));
// }
// a()
export { completion };
