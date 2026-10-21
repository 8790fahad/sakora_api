require("dotenv").config();
const cluster = require("cluster");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const path = require("path");

const { getJwtSecret } = require("./config/secrets");
const { getAllowedOrigins, isOriginAllowed } = require("./utils/origins");
const { isRedisEnabled, getRedis, closeRedis, redisPing } = require("./config/redis");
const { queueStats, closeQueue } = require("./queues/jobQueue");
const { startNotifyWorkers, stopNotifyWorkers } = require("./workers/notifyWorker");

// Fail fast on weak production secrets
getJwtSecret();

const app = express();
const PORT = process.env.PORT || 5100;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 15000);

// Import database
const db = require("./models");
const { ensureSchema } = require("./utils/ensureSchema");
const { attachLive, listenForStockRelay } = require("./utils/live");

// Middleware
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());

const allowedOrigins = getAllowedOrigins();

// Deferred limiters so Redis store can be attached before traffic starts
let apiLimiter = (req, res, next) => next();
let authLimiter = (req, res, next) => next();
let newsletterLimiter = (req, res, next) => next();

app.use("/api", (req, res, next) => apiLimiter(req, res, next));
app.use("/api/auth/login", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/register", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/google", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/verify-email", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/resend-verification", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/forgot-password", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/reset-password", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/forgot-password", (req, res, next) => authLimiter(req, res, next));
app.use("/api/auth/reset-password", (req, res, next) => authLimiter(req, res, next));
app.use("/api/newsletter", (req, res, next) => newsletterLimiter(req, res, next));

async function buildRateLimitStore(prefix) {
  if (!isRedisEnabled()) return undefined;
  try {
    const redis = await getRedis();
    if (!redis) return undefined;
    const { RedisStore } = require("rate-limit-redis");
    return new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix,
    });
  } catch (error) {
    console.error("[rate-limit] Redis store unavailable:", error.message);
    return undefined;
  }
}

async function createLimiters() {
  const apiStore = await buildRateLimitStore("rl:api:");
  const authStore = await buildRateLimitStore("rl:auth:");
  const newsletterStore = await buildRateLimitStore("rl:newsletter:");
  const common = {
    standardHeaders: true,
    legacyHeaders: false,
  };

  apiLimiter = rateLimit({
    ...common,
    ...(apiStore ? { store: apiStore } : {}),
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 300),
    skip: (req) =>
      req.originalUrl === "/api/payments/webhook" ||
      req.originalUrl.startsWith("/api/health"),
  });
  authLimiter = rateLimit({
    ...common,
    ...(authStore ? { store: authStore } : {}),
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT || 30),
    message: { success: false, message: "Too many attempts. Please wait and try again." },
  });
  newsletterLimiter = rateLimit({
    ...common,
    ...(newsletterStore ? { store: newsletterStore } : {}),
    windowMs: 60 * 60 * 1000,
    limit: 8,
    message: { success: false, message: "Too many attempts. Please wait and try again." },
  });

  if (apiStore) {
    console.log("[rate-limit] using Redis store");
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] || "Content-Type, Authorization"
    );
    return res.sendStatus(204);
  }
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "1mb",
  verify: (req, res, buf) => {
    if (req.originalUrl === "/api/payments/webhook") {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || "1mb" }));

// Static file serving for uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  maxAge: "7d",
  etag: true,
}));

// API Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/business", require("./routes/business"));
app.use("/api/products", require("./routes/products"));
app.use("/api/inventory", require("./routes/inventory"));
app.use("/api/purchases", require("./routes/purchases"));
app.use("/api/sales", require("./routes/sales"));
app.use("/api/expenses", require("./routes/expenses"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/suppliers", require("./routes/suppliers"));
app.use("/api/cash", require("./routes/cash"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/storefront", require("./routes/storefront"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/subscriptions", require("./routes/subscriptions"));
app.use("/api/referrals", require("./routes/referrals"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/vat", require("./routes/vat"));
app.use("/api/users", require("./routes/users"));
app.use("/api/newsletter", require("./routes/newsletter"));
app.use("/api/support", require("./routes/support"));

// Cache DB pings so uptime monitors don't hammer MySQL
const HEALTH_DB_TTL_MS = Number(process.env.HEALTH_DB_TTL_MS || 5000);
let healthDbCache = { at: 0, ok: false, error: null };

async function checkDatabase() {
  const now = Date.now();
  if (now - healthDbCache.at < HEALTH_DB_TTL_MS) {
    return healthDbCache;
  }
  try {
    await db.sequelize.query("SELECT 1", { type: db.Sequelize.QueryTypes.SELECT });
    healthDbCache = { at: now, ok: true, error: null };
  } catch (error) {
    healthDbCache = { at: now, ok: false, error: error.message };
  }
  return healthDbCache;
}

// Liveness: process is up (for load balancers / k8s) — no SQL
app.get("/api/health/live", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    pid: process.pid,
  });
});

// Readiness: dependencies reachable
app.get("/api/health/ready", async (req, res) => {
  const database = await checkDatabase();
  const redis = await redisPing();
  const ready = database.ok && (!redis.enabled || redis.ok);
  res.status(ready ? 200 : 503).json({
    status: ready ? "OK" : "UNAVAILABLE",
    database: database.ok ? "up" : "down",
    redis,
    queue: queueStats(),
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint (backward compatible)
app.get("/api/health", async (req, res) => {
  const database = await checkDatabase();
  if (!database.ok) {
    return res.status(503).json({
      status: "UNAVAILABLE",
      message: "Database is not reachable",
      timestamp: new Date().toISOString(),
    });
  }
  const redis = await redisPing();
  res.json({
    status: "OK",
    message: "sakora Mobile API is running",
    timestamp: new Date().toISOString(),
    version: "1.0.2",
    uptime: Math.round(process.uptime()),
    redis: redis.enabled ? (redis.ok ? "up" : "down") : "disabled",
    queue: queueStats().backend,
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);

  // Default error
  let error = {
    success: false,
    message: "Internal server error",
  };

  // Sequelize validation error
  if (err.name === "SequelizeValidationError") {
    error.message = "Validation error";
    error.details = err.errors.map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  // JWT error
  if (err.name === "JsonWebTokenError") {
    error.message = "Invalid token";
  }

  // Sequelize unique constraint error
  if (err.name === "SequelizeUniqueConstraintError") {
    error.message = "Duplicate entry";
    error.field = err.errors[0]?.path;
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json(error);
});

function workerCount() {
  const configured = Number(process.env.WEB_CONCURRENCY || 0);
  if (configured > 0) return configured;
  // Default single process — keeps VPS CPU/RAM quiet. Raise WEB_CONCURRENCY only if needed.
  return 1;
}

async function prepareDatabase() {
  await db.sequelize.authenticate();
  console.log("Database connection established successfully.");
  await ensureSchema(db.sequelize);
  if (process.env.NODE_ENV !== "production") {
    console.log("Syncing database tables...");
    await db.sequelize.sync();
    console.log("Database synchronized successfully.");
  }
}

function listen() {
  const server = app.listen(PORT, () => {
    console.log(`sakora Mobile API server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
  attachLive(server);
  listenForStockRelay();

  // Embed job consumers unless a dedicated worker process is used
  const embedWorker = process.env.QUEUE_WORKER_EMBEDDED !== "false";
  if (embedWorker) {
    startNotifyWorkers().catch((error) => {
      console.error("[queue] failed to start embedded workers:", error.message);
    });
  }

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received`);

    const forceTimer = setTimeout(() => {
      console.error("[shutdown] timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref?.();

    server.close(async () => {
      try {
        await stopNotifyWorkers();
        await closeQueue();
        await closeRedis();
        await db.sequelize.close();
      } catch (error) {
        console.error("[shutdown] cleanup error:", error.message);
      } finally {
        clearTimeout(forceTimer);
        process.exit(0);
      }
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return server;
}

async function startServer() {
  try {
    await createLimiters();

    const count = workerCount();
    const clustered = cluster.isPrimary && count > 1;

    if (clustered) {
      await prepareDatabase();
      await db.sequelize.close();
      for (let i = 0; i < count; i += 1) cluster.fork();
      cluster.on("message", (worker, message) => {
        if (message?.type !== "stock") return;
        for (const id of Object.keys(cluster.workers)) {
          cluster.workers[id].send(message);
        }
      });
      cluster.on("exit", (worker, code) => {
        if (code !== 0 && !worker.exitedAfterDisconnect) {
          console.error(`Worker ${worker.process.pid} exited. Starting another.`);
          cluster.fork();
        }
      });

      const shutdownPrimary = (signal) => {
        console.log(`[shutdown] primary ${signal}`);
        for (const id of Object.keys(cluster.workers)) {
          cluster.workers[id]?.process.kill("SIGTERM");
        }
        setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref?.();
      };
      process.on("SIGTERM", () => shutdownPrimary("SIGTERM"));
      process.on("SIGINT", () => shutdownPrimary("SIGINT"));
      return;
    }

    if (count === 1) {
      await prepareDatabase();
    } else {
      await db.sequelize.authenticate();
    }
    listen();
  } catch (error) {
    console.error("Unable to start server:", error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
