const express = require("express");
const moment = require("moment");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const squad = require("../services/squad");
const { activateSubscription } = require("../services/orders");
const { notifySubscription } = require("../services/notify");
const { errorResponse, successResponse } = require("../utils/helpers");
const { PLANS, planAmount } = require("../utils/plans");

const router = express.Router();

router.get("/plans", authenticate, async (req, res) => {
  const business = await db.Business.findByPk(req.user.businessId);
  const latest = await db.Subscription.findOne({
    where: { businessId: business.id },
    order: [["createdAt", "DESC"]],
  });

  res.json(
    successResponse("Subscription plans", {
      plans: Object.values(PLANS),
      current: {
        plan: business.subscriptionPlan,
        expiry: business.subscriptionExpiry,
        status: latest?.status || "active",
      },
      provider: {
        name: "Squad",
        configured: squad.isConfigured(),
      },
    })
  );
});

router.post(
  "/checkout",
  authenticate,
  requirePermission("billing.manage"),
  async (req, res) => {
    try {
      const planKey = req.body.plan;
      const interval = req.body.interval === "year" ? "year" : "month";
      const plan = PLANS[planKey];
      const amount = planAmount(plan, interval);
      if (!plan || amount <= 0) {
        return res.status(400).json(errorResponse("Select a paid plan"));
      }

      const business = await db.Business.findByPk(req.user.businessId);
      const reference = `SUB${business.id.slice(-6).toUpperCase()}${Date.now()}`;

      const subscription = await db.Subscription.create({
        businessId: business.id,
        plan: plan.key,
        status: "pending",
        amount,
        currency: "NGN",
        paymentReference: reference,
        metadata: { interval },
      });

      const callbackUrl = `${squad.FRONTEND_URL}/billing?ref=${reference}`;
      const initiated = await squad.initiatePayment({
        email: req.user.email,
        amount,
        currency: "NGN",
        customerName: `${req.user.firstName} ${req.user.lastName}`,
        transactionRef: reference,
        callbackUrl,
        isRecurring: true,
        metadata: {
          type: "subscription",
          plan: plan.key,
          interval,
          businessId: business.id,
          subscriptionId: subscription.id,
        },
      });

      const payment = await db.Payment.create({
        businessId: business.id,
        referenceType: "subscription",
        referenceId: subscription.id,
        provider: "squad",
        providerReference: initiated.transaction_ref || reference,
        amount,
        currency: "NGN",
        status: "pending",
        checkoutUrl: initiated.checkout_url,
        metadata: { mock: Boolean(initiated.mock), plan: plan.key, interval },
      });

      res.json(
        successResponse("Complete payment with Squad", {
          subscription,
          payment: {
            reference: payment.providerReference,
            checkoutUrl: payment.checkoutUrl,
            mock: Boolean(initiated.mock),
            publicKey: initiated.public_key,
            amount,
            email: req.user.email,
            customerName: `${req.user.firstName} ${req.user.lastName}`,
            currency: "NGN",
          },
        })
      );
    } catch (error) {
      console.error("Subscription checkout error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to start subscription payment", error.message));
    }
  }
);

router.post(
  "/verify",
  authenticate,
  requirePermission("billing.manage"),
  async (req, res) => {
    try {
      const reference = req.body.reference;
      const payment = await db.Payment.findOne({
        where: {
          businessId: req.user.businessId,
          providerReference: reference,
          referenceType: "subscription",
        },
      });
      if (!payment) {
        return res.status(404).json(errorResponse("Payment not found"));
      }

      const meta =
        typeof payment.metadata === "string"
          ? (() => {
              try {
                return JSON.parse(payment.metadata);
              } catch {
                return {};
              }
            })()
          : payment.metadata || {};
      const wantMock =
        req.body.mock === true ||
        req.body.mock === "true" ||
        req.body.mock === 1 ||
        req.body.mock === "1";
      const mockComplete = wantMock && Boolean(meta.mock);
      const verified = mockComplete
        ? { transaction_status: "Success", mock: true }
        : await squad.verifyPayment(payment.providerReference);

      if (!squad.isSuccessful(verified.transaction_status)) {
        return res.json(
          successResponse("Payment still pending", {
            transactionStatus: verified.transaction_status,
          })
        );
      }

      const subscription = await db.Subscription.findByPk(payment.referenceId);
      const { business } = await activateSubscription(
        subscription,
        payment,
        verified
      );
      await notifySubscription({
        business,
        user: req.user,
        plan: subscription.plan,
        status: "active",
      });

      res.json(
        successResponse("Subscription activated", {
          plan: business.subscriptionPlan,
          expiry: business.subscriptionExpiry,
        })
      );
    } catch (error) {
      res
        .status(500)
        .json(errorResponse("Failed to verify subscription", error.message));
    }
  }
);

router.post(
  "/cancel",
  authenticate,
  requirePermission("billing.manage"),
  async (req, res) => {
    const business = await db.Business.findByPk(req.user.businessId);
    const latest = await db.Subscription.findOne({
      where: { businessId: business.id, status: "active" },
      order: [["createdAt", "DESC"]],
    });
    if (latest) {
      await latest.update({
        status: "cancelled",
        cancelledAt: new Date(),
      });
    }
    await business.update({
      subscriptionPlan: "free",
      subscriptionExpiry: moment().toDate(),
    });
    res.json(successResponse("Subscription cancelled. You are on the Free plan."));
  }
);

module.exports = router;
