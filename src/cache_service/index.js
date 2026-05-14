import client from "../services/cache.service.js";
const REDIS_PREFIX = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_`;
const DEFAULT_REDIS_TTL = 172800; //  2 day
async function storeInCache(identifier, data, ttl = DEFAULT_REDIS_TTL) {
  if (client.isReady) return await client.set(REDIS_PREFIX + identifier, JSON.stringify(data), { EX: ttl });
  return false;
}

async function findInCache(identifier) {
  if (client.isReady) return await client.get(REDIS_PREFIX + identifier);
  return false;
}

// Optimized scan for keys matching a pattern (identifier form, no prefix needed)
async function scanCacheKeys(pattern) {
  if (!client.isReady) return [];
  if (!pattern || typeof pattern !== "string") return [];

  const match = REDIS_PREFIX + pattern;
  const keys = [];
  let processedCount = 0;
  const maxKeys = 10000; // Safety limit for 1GB Redis

  try {
    // Use scanIterator with optimized settings for 1GB Redis
    for await (const key of client.scanIterator({
      MATCH: match,
      COUNT: 2500 // Increased batch size for better performance
    })) {
      keys.push(key.slice(REDIS_PREFIX.length));
      processedCount++;

      // Safety limit to prevent memory issues
      if (processedCount >= maxKeys) {
        console.warn(`Reached maximum key limit: ${maxKeys}. Consider using more specific patterns.`);
        break;
      }

      // Add small delay every 1000 keys to prevent Redis overload
      if (processedCount % 1000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch (error) {
    console.error("Error in scanCacheKeys:", error);
    return keys; // Return what we have so far
  }

  return keys;
}

async function deleteInCache(identifiers) {
  if (!client.isReady) {
    return false;
  }
  if (!Array.isArray(identifiers)) {
    identifiers = [identifiers];
  }
  const keysToDelete = identifiers.map((id) => REDIS_PREFIX + id);

  try {
    const deleteCount = await client.del(keysToDelete);
    console.log(`Deleted ${deleteCount} items from cache`);
    return true;
  } catch (error) {
    console.error("Error during deletion:", error);
    return false;
  }
}

async function verifyTTL(identifier) {
  try {
    if (client.isReady) {
      const ttl = await client.ttl(REDIS_PREFIX + identifier);
      console.log(`TTL for key ${REDIS_PREFIX + identifier} is ${ttl} seconds`);
      return ttl;
    } else {
      console.error("Redis client is not ready");
      return -2; // Indicating error
    }
  } catch (error) {
    console.error("Error retrieving TTL from cache:", error);
    return;
  }
}

export { deleteInCache, storeInCache, findInCache, scanCacheKeys, verifyTTL };
