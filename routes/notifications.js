const express = require("express");
const { Op } = require("sequelize");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const { errorResponse, successResponse, getPagination, getPagingData } = require("../utils/helpers");

const router = express.Router();

router.get(
  "/",
  authenticate,
  requirePermission("notifications.view"),
  async (req, res) => {
    try {
      const { page, size, unread } = req.query;
      const { limit, offset } = getPagination(page, size || 30);
      const where = {
        businessId: req.user.businessId,
        [Op.or]: [{ userId: req.user.id }, { userId: null }],
      };
      if (unread === "true") where.isRead = false;

      const { rows, count } = await db.Notification.findAndCountAll({
        where,
        limit,
        offset,
        order: [["createdAt", "DESC"]],
      });

      const unreadCount = await db.Notification.count({
        where: {
          businessId: req.user.businessId,
          isRead: false,
          [Op.or]: [{ userId: req.user.id }, { userId: null }],
        },
      });

      res.json(
        successResponse("Notifications retrieved", {
          ...getPagingData(rows, page, limit, count),
          unreadCount,
        })
      );
    } catch (error) {
      res
        .status(500)
        .json(errorResponse("Failed to load notifications", error.message));
    }
  }
);

router.patch(
  "/read-all",
  authenticate,
  requirePermission("notifications.view"),
  async (req, res) => {
    await db.Notification.update(
      { isRead: true, readAt: new Date() },
      {
        where: {
          businessId: req.user.businessId,
          isRead: false,
          [Op.or]: [{ userId: req.user.id }, { userId: null }],
        },
      }
    );
    res.json(successResponse("All notifications marked as read"));
  }
);

router.patch(
  "/:id/read",
  authenticate,
  requirePermission("notifications.view"),
  async (req, res) => {
    const notification = await db.Notification.findOne({
      where: {
        id: req.params.id,
        businessId: req.user.businessId,
      },
    });
    if (!notification) {
      return res.status(404).json(errorResponse("Notification not found"));
    }
    await notification.update({ isRead: true, readAt: new Date() });
    res.json(successResponse("Notification updated", { notification }));
  }
);

module.exports = router;
