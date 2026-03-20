import { createClient } from "redis";

const MAX_REDIS_RETRIES = 3;
let redisErrorLogged = false;

const client = createClient({
  url: process.env.REDIS_URI,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries >= MAX_REDIS_RETRIES) {
        if (!redisErrorLogged) {
          console.warn("Redis unavailable after max retries. Running without cache.");
          redisErrorLogged = true;
        }
        return false;
      }
      return retries * 1000;
    }
  }
});

client.on("error", (error) => {
  if (!redisErrorLogged) {
    console.error("Redis:", error.message || error);
  }
});

client.on("ready", () => {
  redisErrorLogged = false;
  console.log("Redis is ready");
});

client.connect().catch(() => {});

export default client;
