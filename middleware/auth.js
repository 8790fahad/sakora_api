const jwt = require("jsonwebtoken");
const db = require("../models");
const { hasPermission } = require("../utils/permissions");

// JWT Secret - use environment variable or fallback for development
const JWT_SECRET =
  process.env.JWT_SECRET || "sakora-dev-secret-key-change-in-production";

// Verify JWT token and set user in request
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No valid token provided.",
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if session exists and is active
    const session = await db.UserSession.findOne({
      where: {
        token,
        userId: decoded.userId,
        isActive: true,
        expiresAt: {
          [db.Sequelize.Op.gt]: new Date(),
        },
      },
      include: [
        {
          model: db.User,
          as: "user",
          include: [
            { model: db.Business, as: "business" },
            { model: db.Branch, as: "branch" },
          ],
        },
      ],
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session.",
      });
    }

    // Update last activity
    await session.update({ lastActivity: new Date() });

    // Set user in request
    req.user = session.user;
    req.session = session;

    next();
  } catch (error) {
    console.error("Authentication error:", error);

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

// Check user roles
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // Convert to array if string
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    // Check if user has required role
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions.",
      });
    }

    next();
  };
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }

    next();
  };
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await db.User.findOne({
      where: { id: decoded.userId },
      include: [
        { model: db.Business, as: "business" },
        { model: db.Branch, as: "branch" },
      ],
    });

    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Ignore errors for optional auth
    console.log("Optional auth failed:", error.message);
  }

  next();
};

module.exports = {
  authenticate,
  authorize,
  requirePermission,
  optionalAuth,
};
