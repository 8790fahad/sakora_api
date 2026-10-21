const express = require("express");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const { errorResponse, successResponse } = require("../utils/helpers");
const {
  REFERRAL_COMMISSION_RATE,
  generateReferralCode,
  normalizeReferralCode,
} = require("../utils/referrals");
const { FRONTEND_URL } = require("../services/squad");

const router = express.Router();

const ensureBusinessReferralCode = async (business) => {
  if (business.referralCode) return business;
  const code = await generateReferralCode();
  await business.update({ referralCode: code });
  return business.reload();
};

router.get(
  "/",
  authenticate,
  requirePermission("billing.manage"),
  async (req, res) => {
    try {
      let business = await db.Business.findByPk(req.user.businessId);
      if (!business) {
        return res.status(404).json(errorResponse("Business not found"));
      }
      business = await ensureBusinessReferralCode(business);

      const referralCount = await db.Business.count({
        where: { referredByBusinessId: business.id },
      });

      const referrals = await db.Business.findAll({
        where: { referredByBusinessId: business.id },
        attributes: [
          "id",
          "name",
          "subscriptionPlan",
          "subscriptionExpiry",
          "createdAt",
        ],
        order: [["createdAt", "DESC"]],
        limit: 50,
      });

      const commissionCount = await db.ReferralCommission.count({
        where: { referrerBusinessId: business.id },
      });

      const commissions = await db.ReferralCommission.findAll({
        where: { referrerBusinessId: business.id },
        include: [
          {
            model: db.Business,
            as: "referred",
            attributes: ["id", "name"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: 50,
      });

      const totals = await db.ReferralCommission.findAll({
        where: { referrerBusinessId: business.id },
        attributes: [
          "status",
          [db.sequelize.fn("SUM", db.sequelize.col("amount")), "total"],
        ],
        group: ["status"],
        raw: true,
      });

      const summary = {
        earned: 0,
        available: 0,
        paid: 0,
        pending: 0,
        cancelled: 0,
        referralCount,
        commissionCount,
      };
      for (const row of totals) {
        const amount = Number(row.total || 0);
        if (row.status !== "cancelled") summary.earned += amount;
        if (row.status === "approved") summary.available = amount;
        if (row.status === "paid") summary.paid = amount;
        if (row.status === "pending") summary.pending = amount;
        if (row.status === "cancelled") summary.cancelled = amount;
      }

      const code = business.referralCode;
      const referralLink = `${FRONTEND_URL.replace(/\/$/, "")}/register?ref=${code}`;

      res.json(
        successResponse("Referral program", {
          code,
          referralLink,
          commissionRate: REFERRAL_COMMISSION_RATE,
          summary,
          referrals,
          commissions,
        })
      );
    } catch (error) {
      console.error("Referrals fetch error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to load referrals", error.message));
    }
  }
);

router.get("/validate/:code", async (req, res) => {
  try {
    const code = normalizeReferralCode(req.params.code);
    if (!code) {
      return res.status(400).json(errorResponse("Referral code is required"));
    }

    const referrer = await db.Business.findOne({
      where: { referralCode: code, status: "active" },
      attributes: ["id", "name", "referralCode"],
    });

    if (!referrer) {
      return res.status(404).json(errorResponse("Invalid referral code"));
    }

    res.json(
      successResponse("Valid referral code", {
        code: referrer.referralCode,
        businessName: referrer.name,
      })
    );
  } catch (error) {
    res
      .status(500)
      .json(errorResponse("Failed to validate referral code", error.message));
  }
});

router.post(
  "/payout-request",
  authenticate,
  requirePermission("billing.manage"),
  async (req, res) => {
    try {
      const business = await db.Business.findByPk(req.user.businessId);
      if (!business) {
        return res.status(404).json(errorResponse("Business not found"));
      }

      const available = await db.ReferralCommission.sum("amount", {
        where: {
          referrerBusinessId: business.id,
          status: "approved",
        },
      });

      const balance = Number(available || 0);
      if (balance <= 0) {
        return res
          .status(400)
          .json(errorResponse("No available commission balance to request"));
      }

      const note = String(req.body.note || "").trim().slice(0, 500);
      const currentSettings =
        business.settings && typeof business.settings === "object"
          ? business.settings
          : {};
      await business.update({
        settings: {
          ...currentSettings,
          referralPayoutRequest: {
            amount: balance,
            note: note || null,
            requestedAt: new Date().toISOString(),
            requestedBy: req.user.id,
            status: "requested",
          },
        },
      });

      res.json(
        successResponse(
          "Payout request submitted. Our team will process it shortly.",
          {
            amount: balance,
            currency: "NGN",
          }
        )
      );
    } catch (error) {
      console.error("Referral payout request error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to request payout", error.message));
    }
  }
);

module.exports = router;
