import client from "../cache.service.js";
import { findInCache, storeInCache } from "../../cache_service/index.js";
import { redis_keys } from "../../configs/constant.js";
import logger from "../../logger.js";

const REDIS_PREFIX = "AIMIDDLEWARE_";
const FILES_TTL = 604800; // 7 days

async function saveFilesToRedis({ thread_id, sub_thread_id, bridge_id, files }) {
  try {
    const cache_key = `${redis_keys.files_}${bridge_id}_${thread_id}_${sub_thread_id}`;
    const existing_cache = await findInCache(cache_key);

    if (existing_cache) {
      try {
        const cached_files = JSON.parse(existing_cache);
        if (JSON.stringify(cached_files) === JSON.stringify(files)) {
          if (client.isReady) {
            await client.expire(`${REDIS_PREFIX}${cache_key}`, FILES_TTL);
          }
        } else {
          await storeInCache(cache_key, files, FILES_TTL);
        }
      } catch {
        await storeInCache(cache_key, files, FILES_TTL);
      }
    } else {
      await storeInCache(cache_key, files, FILES_TTL);
    }
  } catch (err) {
    logger.error(`Error in saveFilesToRedis: ${err.message}`);
  }
}

export { saveFilesToRedis };
