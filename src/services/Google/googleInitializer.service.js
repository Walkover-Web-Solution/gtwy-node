import { GoogleGenerativeAI } from "@google/generative-ai";
class googleInitializer {
  constructor(api_key) {
    this.genAI = new GoogleGenerativeAI(api_key);
  }
  getGenerativeModel = () => {
    return this.genAI;
  };
}
export default googleInitializer;
