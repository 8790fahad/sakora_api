const db = require("../models");
const { sendEmail } = require("./mail");
const { sendSms } = require("./sms");

const createNotification = async ({
  businessId,
  userId = null,
  type = "system",
  title,
  message,
  actionUrl = null,
  metadata = {},
  priority = "medium",
}) => {
  return db.Notification.create({
    businessId,
    userId,
    type,
    title,
    message,
    actionUrl,
    metadata,
    priority,
    isRead: false,
  });
};

const notifyBusinessUsers = async ({
  businessId,
  type,
  title,
  message,
  actionUrl,
  metadata,
  priority,
}) => {
  const users = await db.User.findAll({
    where: { businessId, status: "active" },
    attributes: ["id"],
  });

  const records = [];
  for (const user of users) {
    records.push(
      await createNotification({
        businessId,
        userId: user.id,
        type,
        title,
        message,
        actionUrl,
        metadata,
        priority,
      })
    );
  }
  return records;
};

const notifyOrderPlaced = async (order, business) => {
  const title = `New order ${order.orderNumber}`;
  const message = `${order.customerName} placed an order totaling ₦${parseFloat(
    order.total
  ).toLocaleString()}`;

  await notifyBusinessUsers({
    businessId: order.businessId,
    type: "order",
    title,
    message,
    actionUrl: "/orders",
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
    priority: "high",
  });

  if (order.customerEmail) {
    await sendEmail({
      businessId: order.businessId,
      to: order.customerEmail,
      subject: `Order ${order.orderNumber} received`,
      templateKey: "order_placed",
      text: `Hi ${order.customerName},\n\nWe received your order ${order.orderNumber} from ${business.name}. Total: ₦${order.total}.\nWe will notify you when payment is confirmed.`,
    });
  }

  if (order.customerPhone) {
    await sendSms({
      businessId: order.businessId,
      to: order.customerPhone,
      templateKey: "order_placed",
      body: `${business.name}: Order ${order.orderNumber} received. Total ₦${order.total}.`,
    });
  }
};

const notifyPaymentSuccess = async (order, business) => {
  const title = `Payment received for ${order.orderNumber}`;
  const message = `₦${parseFloat(order.total).toLocaleString()} paid via Squad`;

  await notifyBusinessUsers({
    businessId: order.businessId,
    type: "payment",
    title,
    message,
    actionUrl: "/orders",
    metadata: { orderId: order.id },
    priority: "high",
  });

  if (order.customerEmail) {
    await sendEmail({
      businessId: order.businessId,
      to: order.customerEmail,
      subject: `Payment confirmed — ${order.orderNumber}`,
      templateKey: "order_paid",
      text: `Hi ${order.customerName},\n\nPayment for order ${order.orderNumber} was successful. ${business.name} is preparing your order.`,
    });
  }

  if (order.customerPhone) {
    await sendSms({
      businessId: order.businessId,
      to: order.customerPhone,
      templateKey: "order_paid",
      body: `${business.name}: Payment confirmed for ${order.orderNumber}. We are preparing your order.`,
    });
  }
};

const notifyOrderStatus = async (order, business, status) => {
  await notifyBusinessUsers({
    businessId: order.businessId,
    type: "order",
    title: `Order ${order.orderNumber} is ${status}`,
    message: `${order.customerName}'s order is now ${status}.`,
    actionUrl: "/orders",
    metadata: { orderId: order.id, status },
    priority: "medium",
  });

  if (order.customerEmail) {
    await sendEmail({
      businessId: order.businessId,
      to: order.customerEmail,
      subject: `Order ${order.orderNumber} update: ${status}`,
      templateKey: "order_status",
      text: `Hi ${order.customerName},\n\nYour order ${order.orderNumber} from ${business.name} is now ${status}.`,
    });
  }

  if (order.customerPhone) {
    await sendSms({
      businessId: order.businessId,
      to: order.customerPhone,
      templateKey: "order_status",
      body: `${business.name}: Order ${order.orderNumber} is now ${status}.`,
    });
  }
};

const notifySubscription = async ({ business, user, plan, status }) => {
  if (user) {
    await createNotification({
      businessId: business.id,
      userId: user.id,
      type: "subscription",
      title: `Subscription ${status}`,
      message: `${business.name} is now on the ${plan} plan.`,
      actionUrl: "/billing",
      metadata: { plan, status },
      priority: "high",
    });
  }

  if (user?.email) {
    await sendEmail({
      businessId: business.id,
      to: user.email,
      subject: `Sakora ${plan} plan ${status}`,
      templateKey: "subscription",
      text: `Hi ${user.firstName},\n\nYour Sakora ${plan} subscription is ${status}.`,
    });
  }
};

module.exports = {
  createNotification,
  notifyBusinessUsers,
  notifyOrderPlaced,
  notifyPaymentSuccess,
  notifyOrderStatus,
  notifySubscription,
};
