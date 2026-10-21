/**
 * PM2 process file for sakora API + optional dedicated queue worker.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *
 * Set REDIS_URL in .env for shared rate limits and durable job queues.
 * Set QUEUE_WORKER_EMBEDDED=false on the web app when running sakora-worker.
 */
module.exports = {
  apps: [
    {
      name: "sakora-api",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      kill_timeout: 16000,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sakora-worker",
      script: "workers/notifyWorker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      kill_timeout: 16000,
      max_memory_restart: "256M",
      // Disabled by default — enable when REDIS_URL is configured:
      // pm2 start ecosystem.config.cjs --only sakora-worker
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
