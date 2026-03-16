import axios from "axios";
import { callAiMiddleware } from "../utils/aiCall.utils.js";
import { bridge_ids } from "../../configs/constant.js";
import AgentMemory from "../../mongoModel/AgentMemory.model.js";
import logger from "../../logger.js";

const HIPPOCAMPUS_BASE_URL = process.env.HIPPOCAMPUS_BASE_URL || "http://hippocampus.gtwy.ai";
const HIPPOCAMPUS_SEARCH_URL = `${HIPPOCAMPUS_BASE_URL}/search`;
const HIPPOCAMPUS_RESOURCE_URL = `${HIPPOCAMPUS_BASE_URL}/resource`;

/**
 * Validates the input parameters
 * @param {Object} params - The parameters to validate
 * @returns {Object} - { isValid: boolean, error?: string }
 */
function validateParams(params) {
  if (!params || typeof params !== "object") {
    return { isValid: false, error: "Invalid params: expected an object" };
  }
  
  const { agent_id } = params;
  
  if (!agent_id || typeof agent_id !== "string") {
    return { isValid: false, error: "Missing or invalid agent_id" };
  }
  
  return { isValid: true };
}

/**
 * Search Hippocampus for similar memories
 */
async function searchHippocampusForMemories({ canonical_question, agent_id, top_k = 5, limit = 5, minScore = 0.9 }) {
  try {
    if (!process.env.HIPPOCAMPUS_API_KEY || !process.env.HIPPOCAMPUS_COLLECTION_ID) {
      return { resource_id: null, score: 0 };
    }

    const headers = {
      "x-api-key": process.env.HIPPOCAMPUS_API_KEY,
      "Content-Type": "application/json"
    };
    const payload = {
      query: canonical_question,
      ownerId: agent_id,
      collectionId: process.env.HIPPOCAMPUS_COLLECTION_ID,
      top_k,
      limit,
      minScore
    };

    const response = await axios.post(HIPPOCAMPUS_SEARCH_URL, payload, { headers });
    const results = response.data?.result || [];

    if (results.length > 0) {
      const top = results[0];
      const resource_id = top.payload?.resourceId;
      const score = top.score || 0;
      logger.info(`Agent Memory: Top match resource_id=${resource_id}, score=${(score * 100).toFixed(1)}%`);
      return { resource_id, score };
    }

    return { resource_id: null, score: 0 };
  } catch (err) {
    logger.error(`Agent Memory: Error searching Hippocampus: ${err.message}`);
    return { resource_id: null, score: 0 };
  }
}

/**
 * Update frequency count for existing memory
 */
async function updateFrequencyInMongodb(resource_id) {
  try {
    if (!resource_id) {
      return false;
    }
    
    const result = await AgentMemory.updateOne(
      { resource_id },
      { $inc: { frequency: 1 }, $set: { last_seen: new Date() } }
    );
    return result.modifiedCount > 0;
  } catch (err) {
    logger.error(`Agent Memory: Error updating frequency: ${err.message}`);
    return false;
  }
}

/**
 * Call canonicalizer agent to extract canonical question
 */
async function callCanonicalizerAgent({ system_prompt, user_message, llm_response }) {
  try {
    const user = `System: ${system_prompt || ""}\n\nUser: ${user_message || ""}\n\nAssistant: ${llm_response || ""}`;
    const result = await callAiMiddleware(user, bridge_ids.canonicalizer);
    return result;
  } catch (err) {
    logger.error(`Agent Memory: Error calling canonicalizer agent: ${err.message}`);
    return null;
  }
}

/**
 * Create new memory in Hippocampus and MongoDB
 */
async function createMemoryInHippocampusAndMongodb({ canonical_question, original_answer, agent_id, bridge_name }) {
  try {
    if (!process.env.HIPPOCAMPUS_API_KEY || !process.env.HIPPOCAMPUS_COLLECTION_ID) {
      logger.warn("Agent Memory: Hippocampus not configured");
      return false;
    }

    if (!canonical_question || !agent_id) {
      logger.warn("Agent Memory: Missing required fields for memory creation");
      return false;
    }

    const content = JSON.stringify({ question: canonical_question, answer: original_answer || "" });
    const payload = {
      collectionId: process.env.HIPPOCAMPUS_COLLECTION_ID,
      title: bridge_name || agent_id,
      ownerId: agent_id,
      content,
      settings: {
        strategy: "custom",
        chunkingUrl: "https://flow.sokt.io/func/scriQywSNndU",
        chunkSize: 4000
      }
    };

    const headers = { "x-api-key": process.env.HIPPOCAMPUS_API_KEY, "Content-Type": "application/json" };
    const response = await axios.post(HIPPOCAMPUS_RESOURCE_URL, payload, { headers });
    const resource_id = response.data?._id;

    if (!resource_id) {
      logger.error("Agent Memory: Failed to create resource in Hippocampus");
      return false;
    }

    await AgentMemory.create({
      resource_id,
      agent_id,
      canonical_question,
      original_answer: original_answer || null,
      frequency: 1,
      created_at: new Date(),
      last_seen: new Date()
    });

    logger.info(`Agent Memory: Created new memory for agent_id=${agent_id}`);
    return true;
  } catch (err) {
    logger.error(`Agent Memory: Error creating memory: ${err.message}`);
    return false;
  }
}

/**
 * Save conversation to agent memory (Hippocampus + MongoDB)
 * @param {Object} data - Agent memory data
 * @param {string} data.user_question - User's question
 * @param {string} data.assistant_answer - Assistant's answer
 * @param {string} data.agent_id - Agent/Bridge ID
 * @param {string} data.system_prompt - System prompt
 * @param {string} data.bridge_name - Bridge name
 */
async function saveToAgentMemory(data) {
  const validation = validateParams(data);
  if (!validation.isValid) {
    logger.warn(`saveToAgentMemory: ${validation.error}`);
    return false;
  }

  const { user_question, assistant_answer, agent_id, system_prompt, bridge_name = "" } = data;

  try {
    if (!process.env.HIPPOCAMPUS_API_KEY || !process.env.HIPPOCAMPUS_COLLECTION_ID) {
      logger.warn("Agent Memory: Hippocampus not configured");
      return false;
    }

    if (!user_question) {
      logger.warn("Agent Memory: Missing user_question");
      return false;
    }

    logger.info(`Agent Memory: Searching for similar question: '${user_question.slice(0, 50)}...'`);
    const { resource_id } = await searchHippocampusForMemories({
      canonical_question: user_question,
      agent_id,
      top_k: 5,
      limit: 5,
      minScore: 0.9
    });

    if (resource_id) {
      logger.info(`Agent Memory: Match found, incrementing frequency`);
      return await updateFrequencyInMongodb(resource_id);
    }

    logger.info("Agent Memory: No match found, calling Canonicalizer");
    const canonical_data = await callCanonicalizerAgent({
      system_prompt: system_prompt || "",
      user_message: user_question,
      llm_response: assistant_answer || ""
    });

    if (!canonical_data) {
      logger.error("Agent Memory: Failed to get response from Canonicalizer");
      return false;
    }

    if (!canonical_data.is_agent_level) {
      logger.info(`Agent Memory: Not agent-level, not saving`);
      return false;
    }

    const canonical_question = canonical_data.question;
    if (!canonical_question) {
      logger.error("Agent Memory: Canonicalizer did not return canonical question");
      return false;
    }

    return await createMemoryInHippocampusAndMongodb({
      canonical_question,
      original_answer: assistant_answer,
      agent_id,
      bridge_name
    });
  } catch (err) {
    logger.error(`Agent Memory: Error saving to agent memory: ${err.message}`);
    return false;
  }
}

export { saveToAgentMemory };
