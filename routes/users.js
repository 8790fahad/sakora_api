const express = require("express");
const { body } = require("express-validator");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const { handleValidationErrors } = require("../utils/validation");
const {
  errorResponse,
  successResponse,
} = require("../utils/helpers");
const {
  permissionCatalog,
  ROLE_PERMISSIONS,
  serializeUser,
  ALL_PERMISSIONS,
} = require("../utils/permissions");
const { enqueueSafe } = require("../queues/jobQueue");
const { createNotification } = require("../services/notify");
const {
  assertBranchInBusiness,
  handleTenantError,
} = require("../utils/tenant");

const router = express.Router();

router.get(
  "/permissions",
  authenticate,
  requirePermission("team.view"),
  (req, res) => {
    res.json(
      successResponse("Permission catalog", {
        permissions: permissionCatalog(),
        roles: ROLE_PERMISSIONS,
      })
    );
  }
);

router.get(
  "/",
  authenticate,
  requirePermission("team.view"),
  async (req, res) => {
    try {
      const users = await db.User.findAll({
        where: { businessId: req.user.businessId },
        include: [{ model: db.Branch, as: "branch" }],
        order: [["createdAt", "ASC"]],
      });
      res.json(
        successResponse("Team retrieved", {
          users: users.map(serializeUser),
        })
      );
    } catch (error) {
      res.status(500).json(errorResponse("Failed to load team", error.message));
    }
  }
);

router.post(
  "/",
  authenticate,
  requirePermission("team.manage"),
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }),
    body("firstName").trim().isLength({ min: 2, max: 50 }),
    body("lastName").trim().isLength({ min: 2, max: 50 }),
    body("role").isIn(["manager", "staff"]),
    body("permissions").optional().isArray(),
    body("preferences").optional().isObject(),
    body("preferences.pos.defaultPaymentMethod")
      .optional()
      .isIn(["cash", "bank"]),
    body("preferences.pos.defaultBankAccountId").optional({ nullable: true }),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        phone,
        role,
        branchId,
        permissions,
        preferences,
      } = req.body;

      const existing = await db.User.findOne({
        where: { email },
        paranoid: false,
      });
      if (existing) {
        return res
          .status(400)
          .json(errorResponse("A user already exists with this email"));
      }

      const assignedBranchId = branchId || req.user.branchId;
      await assertBranchInBusiness(assignedBranchId, req.user.businessId);

      const defaultPaymentMethod =
        preferences?.pos?.defaultPaymentMethod === "bank" ? "bank" : "cash";
      const defaultBankAccountId =
        preferences?.pos?.defaultBankAccountId
          ? String(preferences.pos.defaultBankAccountId)
          : null;

      const user = await db.User.create({
        email,
        password,
        firstName,
        lastName,
        phone: phone || null,
        role,
        status: "active",
        businessId: req.user.businessId,
        branchId: assignedBranchId,
        permissions: Array.isArray(permissions)
          ? permissions.filter((key) => ALL_PERMISSIONS.includes(key))
          : null,
        preferences: {
          pos: {
            defaultPaymentMethod,
            defaultBankAccountId:
              defaultPaymentMethod === "bank" ? defaultBankAccountId : null,
          },
        },
      });

      await createNotification({
        businessId: req.user.businessId,
        userId: user.id,
        type: "team",
        title: "Welcome to the team",
        message: `You were added as ${role} by ${req.user.firstName}.`,
        actionUrl: "/dashboard",
      });

      await enqueueSafe("notify.email", {
        businessId: req.user.businessId,
        to: email,
        subject: "You have been added to Sakora",
        templateKey: "team_invite",
        text: `Hi ${firstName},\n\nYou now have a ${role} account on Sakora. Sign in with this email and the password you were given.`,
      });

      res.status(201).json(
        successResponse("Team member added", { user: serializeUser(user) })
      );
    } catch (error) {
      if (handleTenantError(res, error)) return;
      console.error("Create user error:", error);
      res.status(500).json(errorResponse("Failed to add user", error.message));
    }
  }
);

router.put(
  "/:id",
  authenticate,
  requirePermission("team.manage"),
  [
    body("role").optional().isIn(["manager", "staff"]),
    body("status").optional().isIn(["active", "inactive"]),
    body("permissions").optional().isArray(),
    body("defaultPaymentMethod").optional().isIn(["cash", "bank"]),
    body("defaultBankAccountId").optional({ nullable: true }),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const user = await db.User.findOne({
        where: { id: req.params.id, businessId: req.user.businessId },
      });
      if (!user) {
        return res.status(404).json(errorResponse("User not found"));
      }
      if (user.role === "owner" && req.user.id !== user.id) {
        return res
          .status(400)
          .json(errorResponse("The business owner cannot be modified this way"));
      }

      const updates = {};
      if (req.body.role && user.role !== "owner") updates.role = req.body.role;
      if (req.body.status && user.role !== "owner") updates.status = req.body.status;
      if (req.body.branchId && user.role !== "owner") {
        await assertBranchInBusiness(req.body.branchId, req.user.businessId);
        updates.branchId = req.body.branchId;
      }
      if (Array.isArray(req.body.permissions) && user.role !== "owner") {
        updates.permissions = req.body.permissions.filter((key) =>
          ALL_PERMISSIONS.includes(key)
        );
      }
      if (
        req.body.defaultPaymentMethod !== undefined ||
        req.body.defaultBankAccountId !== undefined
      ) {
        const preferences =
          user.preferences && typeof user.preferences === "object"
            ? { ...user.preferences }
            : {};
        const nextMethod =
          req.body.defaultPaymentMethod === "bank" ||
          req.body.defaultPaymentMethod === "cash"
            ? req.body.defaultPaymentMethod
            : preferences.pos?.defaultPaymentMethod === "bank"
              ? "bank"
              : "cash";
        const nextBankId =
          req.body.defaultBankAccountId !== undefined
            ? req.body.defaultBankAccountId
              ? String(req.body.defaultBankAccountId)
              : null
            : preferences.pos?.defaultBankAccountId || null;
        updates.preferences = {
          ...preferences,
          pos: {
            ...(preferences.pos || {}),
            defaultPaymentMethod: nextMethod,
            defaultBankAccountId: nextMethod === "bank" ? nextBankId : null,
          },
        };
      }
      await user.update(updates);
      res.json(successResponse("User updated", { user: serializeUser(user) }));
    } catch (error) {
      if (handleTenantError(res, error)) return;
      res.status(500).json(errorResponse("Failed to update user", error.message));
    }
  }
);

module.exports = router;
