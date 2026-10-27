const express = require("express");
const { body } = require("express-validator");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const { handleValidationErrors } = require("../utils/validation");
const {
  errorResponse,
  successResponse,
  getPagination,
  getPagingData,
  generateBusinessNumber,
} = require("../utils/helpers");
const { notifyOrderStatus, notifyOrderPlaced } = require("../services/notify");
const squad = require("../services/squad");
const { readMerchantSquad } = require("../services/merchantSquad");

const router = express.Router();

const include = [
  { model: db.OrderItem, as: "items" },
  { model: db.Customer, as: "customer" },
];

router.get(
  "/",
  authenticate,
  requirePermission("orders.view"),
  async (req, res) => {
    try {
      const { page, size, status, paymentStatus, search } = req.query;
      const { limit, offset } = getPagination(page, size);
      const where = { businessId: req.user.businessId };
      if (status) where.status = status;
      if (paymentStatus) where.paymentStatus = paymentStatus;
      if (search) {
        where[db.Sequelize.Op.or] = [
          { orderNumber: { [db.Sequelize.Op.like]: `%${search}%` } },
          { customerName: { [db.Sequelize.Op.like]: `%${search}%` } },
          { customerEmail: { [db.Sequelize.Op.like]: `%${search}%` } },
          { customerPhone: { [db.Sequelize.Op.like]: `%${search}%` } },
        ];
      }

      const { rows, count } = await db.Order.findAndCountAll({
        where,
        include,
        limit,
        offset,
        order: [["createdAt", "DESC"]],
        distinct: true,
      });

      res.json(
        successResponse(
          "Orders retrieved",
          getPagingData(rows, page, limit, count)
        )
      );
    } catch (error) {
      console.error("List orders error:", error);
      res.status(500).json(errorResponse("Failed to load orders", error.message));
    }
  }
);

router.post(
  "/",
  authenticate,
  requirePermission("orders.manage"),
  [
    body("customerName").trim().isLength({ min: 2, max: 100 }),
    body("customerPhone").optional().isString(),
    body("customerEmail").optional().isEmail().normalizeEmail(),
    body("items").isArray({ min: 1 }),
    body("items.*.productId").isUUID(),
    body("items.*.quantity").isFloat({ min: 0.001 }),
    handleValidationErrors,
  ],
  async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const business = await db.Business.findByPk(req.user.businessId);
      if (!business.storefrontEnabled) {
        await t.rollback();
        return res
          .status(400)
          .json(errorResponse("Turn on the storefront before creating invoices"));
      }
      const credentials = readMerchantSquad(business);
      if (!credentials) {
        await t.rollback();
        return res
          .status(400)
          .json(
            errorResponse(
              "Turn on Squad and save your public and secret keys on the Storefront page"
            )
          );
      }
      const {
        customerName,
        customerPhone,
        customerEmail,
        items,
        notes,
      } = req.body;

      let subtotal = 0;
      let taxableSubtotal = 0;
      const lines = [];
      for (const item of items) {
        const product = await db.Product.findOne({
          where: { id: item.productId, businessId: business.id },
          transaction: t,
        });
        if (!product) {
          await t.rollback();
          return res.status(400).json(errorResponse("Product not found"));
        }
        const quantity = parseFloat(item.quantity);
        const unitPrice = parseFloat(item.unitPrice || product.sellingPrice);
        const totalPrice = quantity * unitPrice;
        subtotal += totalPrice;
        if (product.vatStatus === "Vatable") taxableSubtotal += totalPrice;
        lines.push({ product, quantity, unitPrice, totalPrice });
      }

      const taxRate = business.taxEnabled ? parseFloat(business.taxRate || 0) : 0;
      const taxAmount = (taxableSubtotal * taxRate) / 100;
      const total = subtotal + taxAmount;
      const count = await db.Order.count({
        where: { businessId: business.id },
        transaction: t,
      });
      const orderNumber = generateBusinessNumber(business.id, "INV", count + 1);
      const paymentReference = `SQ${orderNumber}${Date.now().toString().slice(-4)}`;

      const order = await db.Order.create(
        {
          businessId: business.id,
          branchId: req.user.branchId,
          orderNumber,
          source: "pos",
          status: "pending",
          paymentStatus: "pending",
          paymentMethod: "squad",
          paymentReference,
          customerName,
          customerEmail: customerEmail || null,
          customerPhone: customerPhone || null,
          notes,
          subtotal,
          taxAmount,
          total,
        },
        { transaction: t }
      );

      for (const line of lines) {
        await db.OrderItem.create(
          {
            orderId: order.id,
            productId: line.product.id,
            name: line.product.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            totalPrice: line.totalPrice,
          },
          { transaction: t }
        );
      }

      const payerEmail = String(customerEmail || business.email || "").trim();
      if (!payerEmail) {
        await t.rollback();
        return res
          .status(400)
          .json(errorResponse("Add an email address so Squad can collect this payment"));
      }
      const callbackUrl = `${squad.STOREFRONT_URL}/${
        business.storefrontSlug || "store"
      }/${order.orderNumber}`;
      const initiated = await squad.initiatePayment({
        email: payerEmail,
        amount: total,
        currency: business.currency || "NGN",
        customerName,
        transactionRef: paymentReference,
        callbackUrl,
        credentials,
        metadata: {
          type: "order",
          orderId: order.id,
          orderNumber,
          businessId: business.id,
        },
      });
      await db.Payment.create(
        {
          businessId: business.id,
          referenceType: "order",
          referenceId: order.id,
          provider: "squad",
          providerReference: initiated.transaction_ref || paymentReference,
          amount: total,
          currency: business.currency || "NGN",
          status: "pending",
          checkoutUrl: initiated.checkout_url,
          metadata: { mock: Boolean(initiated.mock) },
        },
        { transaction: t }
      );

      const invoiceUrl = callbackUrl;

      await t.commit();
      await notifyOrderPlaced(order, business);

      res.status(201).json(
        successResponse("Invoice created", {
          order,
          invoiceUrl,
        })
      );
    } catch (error) {
      if (t && !t.finished) await t.rollback();
      res
        .status(error.status && error.status < 500 ? error.status : 500)
        .json(errorResponse("Failed to create invoice", error.message));
    }
  }
);

router.get(
  "/:id",
  authenticate,
  requirePermission("orders.view"),
  async (req, res) => {
    try {
      const order = await db.Order.findOne({
        where: { id: req.params.id, businessId: req.user.businessId },
        include,
      });
      if (!order) {
        return res.status(404).json(errorResponse("Order not found"));
      }
      res.json(successResponse("Order retrieved", { order }));
    } catch (error) {
      res.status(500).json(errorResponse("Failed to load order", error.message));
    }
  }
);

router.patch(
  "/:id/status",
  authenticate,
  requirePermission("orders.manage"),
  [
    body("status").isIn([
      "pending",
      "paid",
      "processing",
      "packed",
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
    ]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const order = await db.Order.findOne({
        where: { id: req.params.id, businessId: req.user.businessId },
        include: [{ model: db.OrderItem, as: "items" }],
      });
      if (!order) {
        return res.status(404).json(errorResponse("Order not found"));
      }

      const nextStatus = req.body.status;
      const updates = { status: nextStatus };
      if (nextStatus === "delivered") updates.fulfilledAt = new Date();
      if (nextStatus === "cancelled") updates.cancelledAt = new Date();
      await order.update(updates);

      const business = await db.Business.findByPk(req.user.businessId);
      await notifyOrderStatus(order, business, nextStatus);

      res.json(successResponse("Order updated", { order }));
    } catch (error) {
      res.status(500).json(errorResponse("Failed to update order", error.message));
    }
  }
);

module.exports = router;
