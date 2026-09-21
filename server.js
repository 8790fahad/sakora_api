require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5100;

// Import database
const db = require("./models");

// Middleware
app.use(helmet());
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? ["https://yourdomain.com"]
        : [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
          ],
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Static file serving for uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Inventria Mobile API is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
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

// Database synchronization and server start
async function startServer() {
  try {
    // Test database connection
    await db.sequelize.authenticate();
    console.log("✅ Database connection established successfully.");

    // Sync database (creates tables if they don't exist)
    // Note: Using sync() without alter to avoid duplicate index issues
    // For schema changes, use migrations or manually alter tables
    console.log("🔄 Syncing database tables...");
    await db.sequelize.sync(); // Using sync() without alter to avoid "too many keys" error
    console.log("✅ Database synchronized successfully.");

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Inventria Mobile API server running on port ${PORT}`);
      console.log(`📱 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error("❌ Unable to start server:", error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
