const jwt = require("jsonwebtoken");
const db = require("../models");
const { hasPermission } = require("../utils/permissions");
const { getJwtSecret } = require("../config/secrets");
const {
  getCachedSession,
  setCachedSession,
  invalidateSession,
} = require("../utils/sessionCache");
const { ensureUserBranchBelongsToBusiness } = require("../utils/tenant");

const JWT_SECRET = getJwtSecret();
const SESSION_ACTIVITY_TTL_MS = Number(
  process.env.SESSION_ACTIVITY_TTL_MS || 60_000
);

async function loadSession(token, userId) {
  return db.UserSession.findOne({
    where: {
      token,
      userId,
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
}

function touchLastActivity(session) {
  const last = session.lastActivity
    ? new Date(session.lastActivity).getTime()
    : 0;
  if (Date.now() - last < SESSION_ACTIVITY_TTL_MS) return;

  session.lastActivity = new Date();
  // Fire-and-forget so auth path doesn't hold a write lock/connection
  session
    .update({ lastActivity: session.lastActivity })
    .catch((error) => console.error("lastActivity update failed:", error.message));
}

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

    let session = getCachedSession(token);
    if (session) {
      if (
        !session.isActive ||
        new Date(session.expiresAt).getTime() <= Date.now()
      ) {
        invalidateSession(token);
        session = null;
      }
    }

    if (!session) {
      session = await loadSession(token, decoded.userId);
      if (session) setCachedSession(token, session);
    }

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session.",
      });
    }

    touchLastActivity(session);

    // Enforce tenant integrity: branch must belong to the user's business
    try {
      await ensureUserBranchBelongsToBusiness(session.user);
    } catch (tenantError) {
      return res.status(tenantError.statusCode || 403).json({
        success: false,
        message: tenantError.message || "Invalid tenant context.",
      });
    }

    // Set user in request
    req.user = session.user;
    req.tenant = {
      businessId: session.user.businessId,
      branchId: session.user.branchId,
    };
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
  invalidateSession,
};
