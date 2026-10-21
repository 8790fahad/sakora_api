let client = null;
let connectPromise = null;

function redisUrl() {
  return process.env.REDIS_URL || process.env.REDIS_URI || "";
}

function isRedisEnabled() {
  return Boolean(redisUrl());
}

async function getRedis() {
  if (!isRedisEnabled()) return null;
  if (client) return client;

  if (!connectPromise) {
    connectPromise = (async () => {
      const Redis = require("ioredis");
      const instance = new Redis(redisUrl(), {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      instance.on("error", (error) => {
        console.error("[redis]", error.message);
      });
      await instance.connect();
      client = instance;
      return client;
    })().catch((error) => {
      connectPromise = null;
      console.error("[redis] connection failed:", error.message);
      return null;
    });
  }

  return connectPromise;
}

async function closeRedis() {
  if (!client) return;
  const current = client;
  client = null;
  connectPromise = null;
  try {
    await current.quit();
  } catch (error) {
    current.disconnect();
  }
}

async function redisPing() {
  const redis = await getRedis();
  if (!redis) return { enabled: false, ok: false };
  try {
    const pong = await redis.ping();
    return { enabled: true, ok: pong === "PONG" };
  } catch (error) {
    return { enabled: true, ok: false, error: error.message };
  }
}

module.exports = {
  redisUrl,
  isRedisEnabled,
  getRedis,
  closeRedis,
  redisPing,
};
