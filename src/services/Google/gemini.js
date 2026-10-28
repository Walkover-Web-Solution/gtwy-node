// node --version # Should be >= 18
// npm install @google/generative-ai
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
async function runChat(configuration, api_key, service) {
  try {
    const genAI = new GoogleGenerativeAI(api_key);
    const model = genAI.getGenerativeModel({
      model: configuration?.model
    });
    delete configuration?.generationConfig?.model;
    configuration.safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      }
    ];
    switch (service) {
      case "chat":
        const chat = model.startChat({
          generationConfig: configuration?.generationConfig,
          history: configuration?.history,
          safetySettings: configuration?.safetySettings
        });
        const result = await chat.sendMessage(configuration?.user_input);
        const response = result.response;
        const history = await chat.getHistory();
        const msgContent = {
          role: "user",
          parts: [
            {
              text: configuration?.user_input
            }
          ]
        };
        const contents = [...history, msgContent];
        const { totalTokens: input_tokens } = await model.countTokens({
          contents
        });
        const { totalTokens: output_tokens } = await model.countTokens({
          contents: response.candidates[0].content
        });
        return {
          success: true,
          modelResponse: response,
          usage: {
            input_tokens: input_tokens,
            output_tokens: output_tokens,
            total_tokens: input_tokens + output_tokens
          },
          history: history
        };
      case "completion":
        const promptResponse = await model.generateContent(configuration?.prompt);
        const { totalTokens: prompt_tokens } = await model.countTokens(configuration?.prompt);
        const { totalTokens: completion_tokens } = await model.countTokens(promptResponse.response.text());
        return {
          success: true,
          modelResponse: promptResponse.response,
          usage: {
            input_tokens: prompt_tokens,
            output_tokens: completion_tokens,
            total_tokens: prompt_tokens + completion_tokens
          }
        };
      case "embedding":
        const embeddingResponse = await model.embedContent(configuration?.input || "");
        // const { totalTokens:embedding_tokens } = await model.countTokens(configuration?.input || "");
        // const { totalTokens:embedCompletion_tokens } = await model.countTokens(embeddingResponse.embedding.values);
        return {
          success: true,
          modelResponse: embeddingResponse.embedding,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0
          }
        };
    }
    return {
      success: false,
      error: "operation undefined!"
    };
  } catch (error) {
    console.error("gemini error=>", error);
    return {
      success: false,
      error: error.message
    };
  }
}
export { runChat }; //     const generationConfig = {
//       temperature: 0.9,
//       topK: 1,
//       topP: 1,
//       maxOutputTokens: 2048,
//     };
//     const chat = model.startChat({
//       generationConfig,
//       safetySettings,
//       history: [
//         {
//           role: "user",
//           parts: [{ text: "hello"}],
//         },
//         {
//           role: "model",
//           parts: [{ text: "Hello there! How can I assist you today?"}],
//         },
//         {
//           role: "user",
//           parts: [{ text: "How are u"}],
//         },
//         {
//           role: "model",
//           parts: [{ text: "I am well, thank you for asking. I am a large language model, designed to provide information and assist with a wide variety of inquiries and tasks. How are you doing today?"}],
//         },
//       ],
//     });
//     const result = await chat.sendMessage("YOUR_USER_INPUT");
//     const response = result.response;
//     console.log(response.text());
//   }
//   runChat();
