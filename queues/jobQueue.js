const { isRedisEnabled, redisUrl, getRedis } = require("../config/redis");

const QUEUE_NAME = "sakora-jobs";
const DEFAULT_CONCURRENCY = Number(process.env.QUEUE_CONCURRENCY || 2);

/** @type {import('bullmq').Queue | null} */
let bullQueue = null;
/** @type {import('bullmq').Worker | null} */
let bullWorker = null;
let redisUsable = null;

const memoryHandlers = new Map();
const memoryQueue = [];
let memoryActive = 0;
let memoryDraining = false;

function connectionOptions() {
  return { url: redisUrl(), maxRetriesPerRequest: null };
}

async function canUseRedis() {
  if (!isRedisEnabled()) return false;
  if (redisUsable !== null) return redisUsable;
  const redis = await getRedis();
  redisUsable = Boolean(redis);
  if (!redisUsable) {
    console.warn("[queue] REDIS_URL set but Redis unreachable; using memory queue");
  }
  return redisUsable;
}

async function getBullQueue() {
  if (!(await canUseRedis())) return null;
  if (bullQueue) return bullQueue;
  try {
    const { Queue } = require("bullmq");
    bullQueue = new Queue(QUEUE_NAME, {
      connection: connectionOptions(),
      defaultJobOptions: {
        attempts: Number(process.env.QUEUE_ATTEMPTS || 5),
        backoff: {
          type: "exponential",
          delay: Number(process.env.QUEUE_BACKOFF_MS || 2000),
        },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
    return bullQueue;
  } catch (error) {
    console.error("[queue] BullMQ init failed:", error.message);
    redisUsable = false;
    return null;
  }
}

function drainMemory() {
  if (memoryDraining) return;
  memoryDraining = true;

  const run = async () => {
    while (memoryActive < DEFAULT_CONCURRENCY && memoryQueue.length > 0) {
      const job = memoryQueue.shift();
      memoryActive += 1;
      Promise.resolve()
        .then(() => {
          const handler = memoryHandlers.get(job.name);
          if (!handler) {
            throw new Error(`No handler registered for job ${job.name}`);
          }
          return handler(job.data);
        })
        .then(job.resolve, job.reject)
        .finally(() => {
          memoryActive -= 1;
          drainMemory();
        });
    }
    memoryDraining = false;
    if (memoryQueue.length > 0 && memoryActive < DEFAULT_CONCURRENCY) {
      drainMemory();
    }
  };

  run();
}

/**
 * Enqueue a named job. Returns immediately after the job is accepted.
 * With Redis/BullMQ the worker (embedded or dedicated) processes it.
 * Without Redis, jobs run in-process with concurrency limits.
 */
async function enqueue(name, data = {}, options = {}) {
  const queue = await getBullQueue();
  if (queue) {
    const job = await queue.add(name, data, {
      jobId: options.jobId,
      priority: options.priority,
      delay: options.delay,
    });
    return { id: job.id, backend: "redis" };
  }

  // Accept immediately so request paths never wait on outbound I/O.
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  memoryQueue.push({
    name,
    data,
    resolve: () => {},
    reject: (error) => {
      console.error(`[queue] memory job ${name} (${id}) failed:`, error.message);
    },
  });
  drainMemory();
  return { id, backend: "memory" };
}

/**
 * Fire-and-forget enqueue that never rejects the caller.
 * Prefer this on HTTP request paths.
 */
function enqueueSafe(name, data = {}, options = {}) {
  return enqueue(name, data, options).catch((error) => {
    console.error(`[queue] failed to enqueue ${name}:`, error.message);
    return null;
  });
}

function registerHandler(name, handler) {
  memoryHandlers.set(name, handler);
}

async function startWorkers(handlers) {
  for (const [name, handler] of Object.entries(handlers)) {
    registerHandler(name, handler);
  }

  if (!(await canUseRedis())) {
    console.log(
      `[queue] in-process memory queue (concurrency=${DEFAULT_CONCURRENCY})`
    );
    return { backend: "memory" };
  }

  if (bullWorker) return { backend: "redis", worker: bullWorker };

  try {
    const { Worker } = require("bullmq");
    bullWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const handler = memoryHandlers.get(job.name);
        if (!handler) {
          throw new Error(`No handler registered for job ${job.name}`);
        }
        return handler(job.data);
      },
      {
        connection: connectionOptions(),
        concurrency: DEFAULT_CONCURRENCY,
      }
    );

    bullWorker.on("failed", (job, error) => {
      console.error(
        `[queue] job ${job?.name} (${job?.id}) failed:`,
        error.message
      );
    });

    console.log(
      `[queue] BullMQ worker listening on ${QUEUE_NAME} (concurrency=${DEFAULT_CONCURRENCY})`
    );
    return { backend: "redis", worker: bullWorker };
  } catch (error) {
    console.error("[queue] BullMQ worker failed, falling back to memory:", error.message);
    redisUsable = false;
    return { backend: "memory" };
  }
}

async function closeQueue() {
  const tasks = [];
  if (bullWorker) {
    tasks.push(bullWorker.close());
    bullWorker = null;
  }
  if (bullQueue) {
    tasks.push(bullQueue.close());
    bullQueue = null;
  }
  await Promise.allSettled(tasks);
}

function queueStats() {
  return {
    backend: redisUsable ? "redis" : "memory",
    redisConfigured: isRedisEnabled(),
    memoryPending: memoryQueue.length,
    memoryActive,
    concurrency: DEFAULT_CONCURRENCY,
  };
}

module.exports = {
  QUEUE_NAME,
  enqueue,
  enqueueSafe,
  registerHandler,
  startWorkers,
  closeQueue,
  queueStats,
  getBullQueue,
};
