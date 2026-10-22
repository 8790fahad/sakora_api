const express = require("express");
const moment = require("moment");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const squad = require("../services/squad");
const { activateSubscription } = require("../services/orders");
const { notifySubscription } = require("../services/notify");
const { errorResponse, successResponse } = require("../utils/helpers");
const { isOriginAllowed } = require("../utils/origins");
const { PLANS, planAmount } = require("../utils/plans");

const router = express.Router();

const billingReturnUrl = (requested, reference) => {
  const fallback = `${squad.FRONTEND_URL}/billing?ref=${encodeURIComponent(reference)}`;
  if (!requested) return fallback;
  try {
    const url = new URL(String(requested));
    if (!isOriginAllowed(url.origin) || url.pathname !== "/billing") {
      return fallback;
    }
    url.searchParams.set("ref", reference);
    url.hash = "";
    return url.toString();
  } catch (error) {
    return fallback;
  }
};

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
      const email = req.user.email || business.email;
      if (!email) {
        return res
          .status(400)
          .json(errorResponse("Add an email on your profile before paying"));
      }
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

      const callbackUrl = billingReturnUrl(req.body.callbackUrl, reference);
      const initiated = await squad.initiatePayment({
        email,
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
            email,
            customerName: `${req.user.firstName} ${req.user.lastName}`,
            currency: "NGN",
          },
        })
      );
    } catch (error) {
      console.error("Subscription checkout error:", error);
      const providerFailed = Boolean(error.status);
      res
        .status(providerFailed ? 400 : 500)
        .json(
          errorResponse(
            providerFailed
              ? error.message
              : "Failed to start subscription payment",
            providerFailed ? null : error.message
          )
        );
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

      if (payment.status === "success") {
        const business = await db.Business.findByPk(req.user.businessId);
        return res.json(
          successResponse("Subscription already active", {
            plan: business.subscriptionPlan,
            expiry: business.subscriptionExpiry,
            alreadyActive: true,
          })
        );
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
            pending: true,
            transactionStatus: verified.transaction_status || "pending",
          })
        );
      }

      const paid = Number(
        verified.transaction_amount ?? verified.amount ?? verified.transactionAmount
      );
      const expectedNaira = parseFloat(payment.amount);
      const expectedKobo = Math.round(expectedNaira * 100);
      const amountMatches =
        !Number.isFinite(paid) ||
        paid <= 0 ||
        paid + 1 >= expectedKobo ||
        Math.abs(paid - expectedNaira) < 1;
      if (!amountMatches) {
        return res
          .status(400)
          .json(errorResponse("Paid amount does not match this plan"));
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
