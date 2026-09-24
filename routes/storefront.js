const express = require("express");
const { body } = require("express-validator");
const db = require("../models");
const { errorResponse, successResponse, generateBusinessNumber } = require("../utils/helpers");
const { uniqueSlug } = require("../utils/slug");
const { handleValidationErrors } = require("../utils/validation");
const { authenticate, requirePermission } = require("../middleware/auth");
const squad = require("../services/squad");
const { notifyOrderPlaced } = require("../services/notify");
const { fulfillPaidOrder } = require("../services/orders");

const router = express.Router();

const storefrontInclude = [
  { model: db.OrderItem, as: "items" },
];

const loadStore = async (slug) => {
  const business = await db.Business.findOne({
    where: {
      storefrontSlug: slug,
      storefrontEnabled: true,
      status: "active",
    },
    include: [{ model: db.Branch, as: "branches" }],
  });
  return business;
};

router.get("/settings", authenticate, requirePermission("storefront.manage"), async (req, res) => {
  try {
    const business = await db.Business.findByPk(req.user.businessId);
    if (!business.storefrontSlug) {
      const slug = await uniqueSlug(db, business.name, business.id);
      await business.update({ storefrontSlug: slug });
    }
    res.json(
      successResponse("Storefront settings", {
        slug: business.storefrontSlug,
        enabled: Boolean(business.storefrontEnabled),
        name: business.name,
        settings: business.storefrontSettings || {},
        url: `${squad.FRONTEND_URL}/shop/${business.storefrontSlug}`,
      })
    );
  } catch (error) {
    res.status(500).json(errorResponse("Failed to load storefront settings", error.message));
  }
});

router.put("/settings", authenticate, requirePermission("storefront.manage"), async (req, res) => {
  try {
    const business = await db.Business.findByPk(req.user.businessId);
    const updates = {};
    if (typeof req.body.enabled === "boolean") {
      updates.storefrontEnabled = req.body.enabled;
    }
    if (req.body.slug) {
      updates.storefrontSlug = await uniqueSlug(db, req.body.slug, business.id);
    }
    if (req.body.settings) {
      updates.storefrontSettings = {
        ...(business.storefrontSettings || {}),
        ...req.body.settings,
      };
    }
    await business.update(updates);
    res.json(
      successResponse("Storefront updated", {
        slug: business.storefrontSlug,
        enabled: Boolean(business.storefrontEnabled),
        name: business.name,
        settings: business.storefrontSettings || {},
        url: `${squad.FRONTEND_URL}/shop/${business.storefrontSlug}`,
      })
    );
  } catch (error) {
    res.status(500).json(errorResponse("Failed to update storefront", error.message));
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const business = await loadStore(req.params.slug);
    if (!business) {
      return res.status(404).json(errorResponse("Storefront not found"));
    }

    const settings = business.storefrontSettings || {};
    const mainBranch =
      (business.branches || []).find((b) => b.isMainBranch) ||
      business.branches?.[0];

    const products = await db.Product.findAll({
      where: {
        businessId: business.id,
        status: "active",
        isOnline: true,
      },
      include: [
        { model: db.Category, as: "category" },
        {
          model: db.Inventory,
          as: "inventory",
          where: mainBranch ? { branchId: mainBranch.id } : undefined,
          required: false,
        },
      ],
      order: [
        ["isFeatured", "DESC"],
        ["name", "ASC"],
      ],
    });

    res.json(
      successResponse("Storefront loaded", {
        store: {
          name: business.name,
          slug: business.storefrontSlug,
          description: business.description,
          logo: business.logo,
          currency: business.currency,
          currencySymbol: business.currencySymbol,
          phone: business.phone,
          email: business.email,
          city: business.city,
          settings,
        },
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          sellingPrice: product.sellingPrice,
          image: product.image,
          unit: product.unit,
          isFeatured: product.isFeatured,
          category: product.category,
          stock: product.inventory?.[0]
            ? parseFloat(product.inventory[0].quantity) -
              parseFloat(product.inventory[0].reservedQuantity || 0)
            : null,
        })),
      })
    );
  } catch (error) {
    console.error("Storefront load error:", error);
    res.status(500).json(errorResponse("Failed to load storefront", error.message));
  }
});

router.post(
  "/:slug/checkout",
  [
    body("customerName").trim().isLength({ min: 2, max: 100 }),
    body("customerEmail").isEmail().normalizeEmail(),
    body("customerPhone").optional().isString(),
    body("items").isArray({ min: 1 }),
    body("items.*.productId").isUUID(),
    body("items.*.quantity").isFloat({ min: 0.001 }),
    handleValidationErrors,
  ],
  async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const business = await loadStore(req.params.slug);
      if (!business) {
        await t.rollback();
        return res.status(404).json(errorResponse("Storefront not found"));
      }

      const mainBranch =
        (await db.Branch.findOne({
          where: { businessId: business.id, isMainBranch: true },
        })) ||
        (await db.Branch.findOne({ where: { businessId: business.id } }));

      const {
        customerName,
        customerEmail,
        customerPhone,
        shippingAddress = {},
        notes,
        items,
      } = req.body;

      let subtotal = 0;
      const lineItems = [];

      for (const item of items) {
        const product = await db.Product.findOne({
          where: {
            id: item.productId,
            businessId: business.id,
            status: "active",
            isOnline: true,
          },
          include: [
            {
              model: db.Inventory,
              as: "inventory",
              where: mainBranch ? { branchId: mainBranch.id } : undefined,
              required: false,
            },
          ],
          transaction: t,
        });

        if (!product) {
          await t.rollback();
          return res.status(400).json(errorResponse("A product in your cart is unavailable"));
        }

        if (product.trackInventory) {
          const stock = parseFloat(product.inventory?.[0]?.quantity || 0);
          if (stock < parseFloat(item.quantity)) {
            await t.rollback();
            return res
              .status(400)
              .json(errorResponse(`${product.name} does not have enough stock`));
          }
        }

        const quantity = parseFloat(item.quantity);
        const unitPrice = parseFloat(product.sellingPrice);
        const totalPrice = quantity * unitPrice;
        subtotal += totalPrice;
        lineItems.push({
          product,
          quantity,
          unitPrice,
          totalPrice,
        });
      }

      const taxRate = business.taxEnabled ? parseFloat(business.taxRate || 0) : 0;
      const taxAmount = (subtotal * taxRate) / 100;
      const shippingAmount = parseFloat(
        business.storefrontSettings?.shippingFee || 0
      );
      const total = subtotal + taxAmount + shippingAmount;

      let customer = await db.Customer.findOne({
        where: {
          businessId: business.id,
          [db.Sequelize.Op.or]: [
            customerEmail ? { email: customerEmail } : null,
            customerPhone ? { phone: customerPhone } : null,
          ].filter(Boolean),
        },
        transaction: t,
      });

      if (!customer) {
        customer = await db.Customer.create(
          {
            businessId: business.id,
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            address: shippingAddress.line1 || shippingAddress.address,
            city: shippingAddress.city,
            customerType: "individual",
            status: "active",
          },
          { transaction: t }
        );
      }

      const count = await db.Order.count({
        where: { businessId: business.id },
        transaction: t,
      });
      const orderNumber = generateBusinessNumber(business.id, "ORD", count + 1);
      const paymentReference = `SQ${orderNumber}${Date.now().toString().slice(-4)}`;

      const order = await db.Order.create(
        {
          businessId: business.id,
          branchId: mainBranch?.id,
          customerId: customer.id,
          orderNumber,
          source: "storefront",
          status: "pending",
          paymentStatus: "pending",
          paymentMethod: "squad",
          paymentReference,
          customerName,
          customerEmail,
          customerPhone,
          shippingAddress,
          notes,
          subtotal,
          taxAmount,
          shippingAmount,
          total,
        },
        { transaction: t }
      );

      for (const line of lineItems) {
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

      const callbackUrl = `${squad.FRONTEND_URL}/shop/${business.storefrontSlug}/order/${order.orderNumber}`;
      const initiated = await squad.initiatePayment({
        email: customerEmail,
        amount: total,
        currency: business.currency || "NGN",
        customerName,
        transactionRef: paymentReference,
        callbackUrl,
        metadata: {
          type: "order",
          orderId: order.id,
          orderNumber,
          businessId: business.id,
        },
      });

      const payment = await db.Payment.create(
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

      await t.commit();

      await notifyOrderPlaced(order, business);

      res.status(201).json(
        successResponse("Checkout created", {
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            total: order.total,
            paymentStatus: order.paymentStatus,
          },
          payment: {
            reference: payment.providerReference,
            checkoutUrl: payment.checkoutUrl,
            mock: Boolean(initiated.mock),
            publicKey: initiated.public_key,
            amount: total,
            email: customerEmail,
            customerName,
            currency: business.currency || "NGN",
          },
        })
      );
    } catch (error) {
      if (t && !t.finished) await t.rollback();
      console.error("Checkout error:", error);
      res.status(500).json(errorResponse("Checkout failed", error.message));
    }
  }
);

router.get("/:slug/orders/:orderNumber", async (req, res) => {
  try {
    const business = await loadStore(req.params.slug);
    if (!business) {
      return res.status(404).json(errorResponse("Storefront not found"));
    }

    const order = await db.Order.findOne({
      where: {
        businessId: business.id,
        orderNumber: req.params.orderNumber,
      },
      include: storefrontInclude,
    });

    if (!order) {
      return res.status(404).json(errorResponse("Order not found"));
    }

    res.json(successResponse("Order retrieved", { order }));
  } catch (error) {
    console.error("Public order error:", error);
    res.status(500).json(errorResponse("Failed to load order", error.message));
  }
});

router.post("/:slug/orders/:orderNumber/verify", async (req, res) => {
  try {
    const business = await loadStore(req.params.slug);
    if (!business) {
      return res.status(404).json(errorResponse("Storefront not found"));
    }

    const order = await db.Order.findOne({
      where: {
        businessId: business.id,
        orderNumber: req.params.orderNumber,
      },
      include: storefrontInclude,
    });

    if (!order) {
      return res.status(404).json(errorResponse("Order not found"));
    }

    const payment = await db.Payment.findOne({
      where: {
        referenceType: "order",
        referenceId: order.id,
      },
      order: [["createdAt", "DESC"]],
    });

    if (!payment) {
      return res.status(404).json(errorResponse("Payment not found"));
    }

    const mockComplete = Boolean(req.body?.mock) && payment.metadata?.mock;
    const verified = mockComplete
      ? { transaction_status: "Success", mock: true }
      : await squad.verifyPayment(payment.providerReference);

    if (squad.isSuccessful(verified.transaction_status)) {
      const paid = await fulfillPaidOrder(order, payment, verified);
      return res.json(successResponse("Payment confirmed", { order: paid }));
    }

    res.json(
      successResponse("Payment still pending", {
        order,
        transactionStatus: verified.transaction_status,
      })
    );
  } catch (error) {
    console.error("Verify order payment error:", error);
    res.status(500).json(errorResponse("Failed to verify payment", error.message));
  }
});

module.exports = router;
