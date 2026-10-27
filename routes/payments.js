const express = require("express");
const db = require("../models");
const squad = require("../services/squad");
const { readMerchantSquad } = require("../services/merchantSquad");
const { fulfillPaidOrder, activateSubscription } = require("../services/orders");
const { notifySubscription } = require("../services/notify");
const { errorResponse, successResponse } = require("../utils/helpers");

const router = express.Router();

const applyPayment = async (providerReference, extra = {}) => {
  const payment = await db.Payment.findOne({
    where: { providerReference },
    order: [["createdAt", "DESC"]],
  });
  if (!payment) return null;

  if (payment.referenceType === "order") {
    const order = await db.Order.findByPk(payment.referenceId, {
      include: [{ model: db.OrderItem, as: "items" }],
    });
    if (order) {
      await fulfillPaidOrder(order, payment, extra);
    }
  }

  if (payment.referenceType === "subscription") {
    const subscription = await db.Subscription.findByPk(payment.referenceId);
    if (subscription) {
      const { business } = await activateSubscription(
        subscription,
        payment,
        extra
      );
      const owner = await db.User.findOne({
        where: { businessId: business.id, role: "owner" },
      });
      await notifySubscription({
        business,
        user: owner,
        plan: subscription.plan,
        status: "active",
      });
    }
  }

  return payment;
};

router.post("/webhook", async (req, res) => {
  try {
    const signature =
      req.headers["x-squad-encrypted-body"] ||
      req.headers["x-squad-signature"];
    const rawBody = req.rawBody
      ? req.rawBody.toString("utf8")
      : JSON.stringify(req.body || {});

    const payload = req.body?.Body || req.body?.body || req.body;
    const transactionRef =
      payload?.transaction_ref ||
      payload?.transactionRef ||
      payload?.data?.transaction_ref;
    const payment = transactionRef
      ? await db.Payment.findOne({
          where: { providerReference: transactionRef },
          order: [["createdAt", "DESC"]],
        })
      : null;
    let signatureOk = false;
    if (payment?.referenceType === "order") {
      const business = await db.Business.findByPk(payment.businessId);
      const secret = readMerchantSquad(business)?.secretKey || "";
      signatureOk = Boolean(
        secret && squad.verifyWebhookSignature(rawBody, signature, secret)
      );
    } else {
      signatureOk = squad.verifyWebhookSignature(rawBody, signature);
    }
    if (!signatureOk) {
      return res.status(401).json(errorResponse("Invalid webhook signature"));
    }
    const status =
      payload?.transaction_status || payload?.data?.transaction_status;

    if (transactionRef && squad.isSuccessful(status)) {
      await applyPayment(transactionRef, payload);
    }

    res.json(successResponse("Webhook processed"));
  } catch (error) {
    console.error("Squad webhook error:", error);
    res.status(500).json(errorResponse("Webhook failed", error.message));
  }
});

module.exports = router;
module.exports.applyPayment = applyPayment;
