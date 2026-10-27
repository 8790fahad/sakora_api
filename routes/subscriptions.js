const express = require("express");
const moment = require("moment");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const squad = require("../services/squad");
const { activateSubscription } = require("../services/orders");
const { notifySubscription } = require("../services/notify");
const { errorResponse, successResponse } = require("../utils/helpers");
const { isOriginAllowed } = require("../utils/origins");
const { PLANS, BILLING_TERMS, quoteTerm, planLabel } = require("../utils/plans");
const { lookupCoupon, priceAfterCoupon } = require("../utils/coupons");

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
      terms: BILLING_TERMS.map((term) => ({
        months: term.months,
        label: term.label,
        bestValue: Boolean(term.bestValue),
      })),
      plans: Object.values(PLANS).map((plan) => ({
        ...plan,
        quotes: BILLING_TERMS.map((term) => quoteTerm(plan, term.months)),
      })),
      current: {
        plan: business.subscriptionPlan,
        planName: planLabel(business.subscriptionPlan),
        expiry: business.subscriptionExpiry,
        status: latest?.status || "active",
        amount: latest?.status === "active" ? parseFloat(latest.amount) : null,
      },
      provider: {
        name: "Squad",
        configured: squad.isConfigured(),
      },
    })
  );
});

const pricedCheckout = (body) => {
  const plan = PLANS[body.plan];
  const quote = plan ? quoteTerm(plan, body.months) : null;
  if (!plan || !quote) return { error: "Select a plan and a billing period" };
  const couponCode = String(body.coupon || "").trim();
  const coupon = couponCode ? lookupCoupon(couponCode) : null;
  if (couponCode && !coupon) return { error: "That coupon is not valid" };
  const priced = priceAfterCoupon(quote.amount, coupon);
  return { plan, quote, coupon, priced };
};

router.post("/quote", authenticate, (req, res) => {
  const result = pricedCheckout(req.body);
  if (result.error) {
    return res.status(400).json(errorResponse(result.error));
  }
  res.json(
    successResponse("Billing quote", {
      plan: result.plan.key,
      months: result.quote.months,
      label: result.quote.label,
      listPrice: result.quote.listPrice,
      save: result.quote.save,
      percentOff: result.quote.percentOff,
      perMonth: result.quote.perMonth,
      amount: result.priced.amount,
      discount: result.priced.discount || 0,
      coupon: result.coupon?.code || null,
      couponPercent: result.coupon?.percent || null,
    })
  );
});

router.post(
  "/checkout",
  authenticate,
  requirePermission("billing.manage"),
  async (req, res) => {
    try {
      const result = pricedCheckout(req.body);
      if (result.error) {
        return res.status(400).json(errorResponse(result.error));
      }
      const { plan, quote, coupon, priced } = result;
      const listPrice = quote.listPrice;
      const amount = priced.amount;
      const interval = quote.months === 12 ? "year" : "month";

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
        metadata: {
          interval,
          months: quote.months,
          listPrice,
          termAmount: quote.amount,
          ...(coupon
            ? { coupon: coupon.code, couponPercent: coupon.percent }
            : {}),
        },
      });

      if (amount === 0) {
        const payment = await db.Payment.create({
          businessId: business.id,
          referenceType: "subscription",
          referenceId: subscription.id,
          provider: "coupon",
          providerReference: reference,
          amount: 0,
          currency: "NGN",
          status: "pending",
          metadata: {
            plan: plan.key,
            interval,
            months: quote.months,
            coupon: coupon.code,
            couponPercent: coupon.percent,
            listPrice,
          },
        });
        const activated = await activateSubscription(subscription, payment, {
          coupon: coupon.code,
        });
        await notifySubscription({
          business: activated.business,
          user: req.user,
          plan: subscription.plan,
          status: "active",
        });
        return res.json(
          successResponse("Coupon applied", {
            activated: true,
            plan: activated.business.subscriptionPlan,
            expiry: activated.business.subscriptionExpiry,
            payment: {
              reference,
              amount: 0,
              coupon: coupon.code,
            },
          })
        );
      }

      const callbackUrl = billingReturnUrl(req.body.callbackUrl, reference);
      const initiated = await squad.initiatePayment({
        email,
        amount,
        currency: "NGN",
        customerName: `${req.user.firstName} ${req.user.lastName}`,
        transactionRef: reference,
        callbackUrl,
        // Squad rejects recurring charges for this merchant. This payment prepays the selected term.
        isRecurring: false,
        metadata: {
          type: "subscription",
          plan: plan.key,
          interval,
          months: quote.months,
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
        metadata: {
          mock: Boolean(initiated.mock),
          plan: plan.key,
          interval,
          months: quote.months,
          listPrice,
          ...(coupon
            ? { coupon: coupon.code, couponPercent: coupon.percent }
            : {}),
        },
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
    res.json(successResponse("Subscription cancelled. You are on no plan."));
  }
);

module.exports = router;
