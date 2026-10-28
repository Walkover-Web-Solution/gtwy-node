import { OpenAI } from "openai";
class OpenAIInitializer {
  constructor(apiKey) {
    this.openai = new OpenAI({
      apiKey: apiKey
    });
  }
  getOpenAIService = () => {
    return this.openai;
  };
}
export default OpenAIInitializer;
