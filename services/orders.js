const moment = require("moment");
const db = require("../models");
const { notifyPaymentSuccess } = require("./notify");
const { publishStock } = require("../utils/live");
const { awardReferralCommission } = require("../utils/referrals");

const fulfillPaidOrder = async (order, payment, extra = {}) => {
  if (order.paymentStatus === "paid") {
    return order;
  }

  const transaction = await db.sequelize.transaction();
  try {
    const locked = await db.Order.findByPk(order.id, {
      include: [{ model: db.OrderItem, as: "items" }],
      transaction,
    });

    if (locked.paymentStatus === "paid") {
      await transaction.commit();
      return locked;
    }

    await locked.update(
      {
        paymentStatus: "paid",
        status: locked.status === "pending" ? "paid" : locked.status,
        paidAmount: locked.total,
        paidAt: new Date(),
        paymentReference: payment.providerReference,
      },
      { transaction }
    );

    await payment.update(
      {
        status: "success",
        paidAt: new Date(),
        metadata: { ...(payment.metadata || {}), ...extra },
      },
      { transaction }
    );

    for (const item of locked.items || []) {
      const inventory = await db.Inventory.findOne({
        where: {
          productId: item.productId,
          branchId: locked.branchId,
        },
        transaction,
      });
      if (inventory) {
        const qty = parseFloat(inventory.quantity) || 0;
        const next = Math.max(0, qty - parseFloat(item.quantity));
        await inventory.update(
          {
            quantity: next,
            lastStockUpdate: new Date(),
          },
          { transaction }
        );
      }
    }

    await transaction.commit();

    const business = await db.Business.findByPk(locked.businessId);
    const fresh = await db.Order.findByPk(locked.id, {
      include: [{ model: db.OrderItem, as: "items" }],
    });
    await notifyPaymentSuccess(fresh, business);
    const productIds = (fresh.items || []).map((item) => item.productId).filter(Boolean);
    publishStock(locked.businessId, productIds).catch((error) => {
      console.error("Storefront stock publish failed:", error.message);
    });
    return fresh;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const activateSubscription = async (subscription, payment, extra = {}) => {
  const start = moment();
  const interval =
    subscription.metadata?.interval || payment.metadata?.interval || "month";
  const end = moment().add(interval === "year" ? 12 : 1, "month");
  await payment.update({
    status: "success",
    paidAt: payment.paidAt || new Date(),
    metadata: { ...(payment.metadata || {}), ...extra },
  });

  await subscription.update({
    status: "active",
    paymentReference: payment.providerReference,
    currentPeriodStart: subscription.currentPeriodStart || start.toDate(),
    currentPeriodEnd: end.toDate(),
  });

  const business = await db.Business.findByPk(subscription.businessId);
  await business.update({
    subscriptionPlan: subscription.plan,
    subscriptionExpiry: end.toDate(),
  });

  try {
    await awardReferralCommission({ business, subscription, payment });
  } catch (error) {
    console.error("Referral commission award failed:", error.message);
  }

  return { subscription, business };
};

module.exports = { fulfillPaidOrder, activateSubscription };
