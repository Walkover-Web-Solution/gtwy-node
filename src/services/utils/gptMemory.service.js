import { findInCache, storeInCache } from "../../cache_service/index.js";
import axios from "axios";

const _isEmptyMemoryResponse = (value) =>
  value && typeof value === "object" && !Array.isArray(value) && value.success === true && value.message === "No response";

export const parseMemory = (raw) => {
  if (raw === null || raw === undefined) return null;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return raw;
    }
  }
  if (_isEmptyMemoryResponse(value)) return null;
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") return value;
  return String(value);
};

const _fetchMemoryFromCache = async (memoryId) => {
  const cachedValue = await findInCache(memoryId);
  return parseMemory(cachedValue);
};

const _fetchMemoryFromRemote = async (memoryId) => {
  try {
    const response = await axios.post("https://flow.sokt.io/func/scriCJLHynCG", { threadID: memoryId });
    const data = response.data;
    if (data === undefined || data === null || _isEmptyMemoryResponse(data)) {
      return null;
    }
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    await storeInCache(memoryId, payload);
    return parseMemory(data);
  } catch (error) {
    console.error(`Error fetching GPT memory from remote for ${memoryId}:`, error.message);
    return null;
  }
};

const _buildMemoryId = (threadId, subThreadId, bridgeId, versionId) => {
  const versionOrBridge = (versionId || bridgeId || "").trim();
  return `${threadId.trim()}_${subThreadId.trim()}_${versionOrBridge}`;
};

const getGptMemory = async (bridgeId, threadId, subThreadId, versionId) => {
  const memoryId = _buildMemoryId(threadId, subThreadId, bridgeId, versionId);
  let memory = await _fetchMemoryFromCache(memoryId);

  if (!memory) {
    memory = await _fetchMemoryFromRemote(memoryId);
  }

  return { memoryId, memory };
};

const retrieveGptMemoryService = async ({ bridge_id, thread_id, sub_thread_id, version_id }) => {
  const { memoryId, memory } = await getGptMemory(bridge_id, thread_id, sub_thread_id, version_id);
  return {
    bridge_id,
    thread_id,
    sub_thread_id,
    version_id,
    memory_id: memoryId,
    found: !!memory,
    memory
  };
};

export default {
  retrieveGptMemoryService,
  parseMemory
};
