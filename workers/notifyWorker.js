require("dotenv").config();

const { startWorkers, closeQueue } = require("../queues/jobQueue");
const { closeRedis } = require("../config/redis");
const { notifyHandlers } = require("../services/notify");

let started = false;

async function startNotifyWorkers() {
  if (started) return;
  started = true;
  return startWorkers(notifyHandlers);
}

async function stopNotifyWorkers() {
  await closeQueue();
  await closeRedis();
  started = false;
}

async function runStandalone() {
  const db = require("../models");
  await db.sequelize.authenticate();
  await startNotifyWorkers();
  console.log("[worker] notify worker running");

  const shutdown = async () => {
    console.log("[worker] shutting down...");
    await stopNotifyWorkers();
    await db.sequelize.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  runStandalone().catch((error) => {
    console.error("[worker] failed to start:", error);
    process.exit(1);
  });
}

module.exports = { startNotifyWorkers, stopNotifyWorkers };
