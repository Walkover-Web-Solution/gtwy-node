/**
 * Centralized configuration for AI prompts used across services.
 * Keeping prompts in a dedicated config makes them easier to maintain, update, and test.
 */

export const GPT_MEMORY_PROMPT = 
  "use the function to store the memory if the user message and history is related to the context or is important to store else don't call the function and ignore it. is purpose is not there than think its the begining of the conversation. Only return the exact memory as output no an extra text jusy memory if present or Just return False";

export const CANONICALIZER_SYSTEM_PROMPT = 
  "You are a question canonicalizer. Given a conversation context, extract and return a canonical question that represents the user's intent.";

export default {
  GPT_MEMORY_PROMPT,
  CANONICALIZER_SYSTEM_PROMPT
};
