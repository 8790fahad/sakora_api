const express = require("express");
const { body, query } = require("express-validator");
const {
  validationRules,
  handleValidationErrors,
} = require("../utils/validation");
const {
  errorResponse,
  successResponse,
  generateBusinessNumber,
  calculateTransactionTotals,
  resolveTaxRate,
  getPagination,
  getPagingData,
} = require("../utils/helpers");
const { authenticate } = require("../middleware/auth");
const db = require("../models");
const { publishStock } = require("../utils/live");
const { assertForBusiness, handleTenantError } = require("../utils/tenant");

const router = express.Router();

class StockError extends Error {
  constructor(message) {
    super(message);
    this.name = "StockError";
    this.statusCode = 400;
  }
}

const quotationInclude = () => [
  {
    model: db.Customer,
    as: "customer",
    attributes: ["id", "name", "phone", "email", "code"],
  },
  {
    model: db.User,
    as: "creator",
    attributes: ["id", "firstName", "lastName"],
  },
  {
    model: db.QuotationItem,
    as: "items",
    separate: true,
    order: [["position", "ASC"]],
    include: [
      {
        model: db.Product,
        as: "product",
        attributes: ["id", "name", "unit", "sku"],
        required: false,
      },
    ],
  },
];

const blankToNull = (value) => {
  const text = String(value || "").trim();
  return text || null;
};

const wantsInventoryReduction = (value) =>
  value === true || value === "true" || value === 1 || value === "1";

async function applyStockChange({
  items,
  businessId,
  branchId,
  direction,
  transaction,
}) {
  const needed = new Map();
  items.forEach((item) => {
    if (!item.productId) return;
    const quantity = parseFloat(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    needed.set(item.productId, (needed.get(item.productId) || 0) + quantity);
  });

  const productIds = [...needed.keys()];
  if (!productIds.length) return [];

  const products = await db.Product.findAll({
    where: { id: productIds, businessId },
    paranoid: direction > 0 ? false : true,
    transaction,
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  if (direction < 0) {
    const missing = productIds.some((id) => productById.get(id)?.status !== "active");
    if (missing) throw new StockError("One or more products not found");
  }

  const rows = await db.Inventory.findAll({
    where: { productId: productIds, branchId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const inventoryByProduct = new Map(rows.map((row) => [row.productId, row]));

  const changed = [];
  for (const [productId, quantity] of needed) {
    const product = productById.get(productId);
    const inventory = inventoryByProduct.get(productId);

    if (direction < 0) {
      if (!product?.trackInventory) continue;
      if (!inventory) {
        throw new StockError(`No stock record for ${product.name}`);
      }
      const onHand = parseFloat(inventory.quantity);
      const available = onHand - parseFloat(inventory.reservedQuantity || 0);
      if (available + 0.0001 < quantity) {
        throw new StockError(
          `Insufficient stock for ${product.name}. Available: ${available} ${product.unit || "pcs"}`
        );
      }
      await inventory.update(
        {
          quantity: Math.max(0, onHand - quantity),
          lastStockUpdate: new Date(),
        },
        { transaction }
      );
      changed.push(productId);
      continue;
    }

    if (!inventory) continue;
    await inventory.update(
      {
        quantity: parseFloat(inventory.quantity) + quantity,
        lastStockUpdate: new Date(),
      },
      { transaction }
    );
    changed.push(productId);
  }

  return changed;
}

router.get(
  "/",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(["open", "cancelled", "all"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status = "all" } = req.query;
      const { offset, limit: pageLimit } = getPagination(page, limit);
      const where = {
        businessId: req.user.businessId,
        branchId: req.user.branchId,
      };
      if (status !== "all") where.status = status;

      const quotations = await db.Quotation.findAndCountAll({
        where,
        include: quotationInclude(),
        order: [["createdAt", "DESC"]],
        limit: pageLimit,
        offset,
        distinct: true,
      });

      const response = getPagingData(
        quotations.rows,
        page,
        pageLimit,
        quotations.count
      );

      res.json(successResponse("Quotations retrieved successfully", response));
    } catch (error) {
      console.error("Quotation list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve quotations", error.message));
    }
  }
);

router.get(
  "/:id",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const quotation = await db.Quotation.findOne({
        where: {
          id: req.params.id,
          businessId: req.user.businessId,
          branchId: req.user.branchId,
        },
        include: quotationInclude(),
      });

      if (!quotation) {
        return res.status(404).json(errorResponse("Quotation not found"));
      }

      res.json(successResponse("Quotation retrieved successfully", { quotation }));
    } catch (error) {
      console.error("Quotation fetch error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve quotation", error.message));
    }
  }
);

router.post(
  "/",
  [
    authenticate,
    body("quotationNumber").optional({ values: "falsy" }).trim().isLength({ min: 1, max: 40 }),
    body("customerId").optional({ values: "falsy" }).isUUID(),
    body("customerName").trim().isLength({ min: 2, max: 100 }).withMessage("Add the customer name"),
    body("customerPhone").optional({ values: "falsy" }).trim().isLength({ max: 30 }),
    body("customerEmail").optional({ values: "falsy" }).trim().isEmail().withMessage("Enter a valid email"),
    body("notes").optional({ values: "falsy" }).trim().isLength({ max: 2000 }),
    body("reduceInventory").optional().isBoolean(),
    body("items").isArray({ min: 1, max: 100 }).withMessage("Add at least one item"),
    body("items.*.description")
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage("Each item needs a description"),
    body("items.*.quantity")
      .isFloat({ min: 0.001 })
      .withMessage("Quantity must be greater than zero"),
    body("items.*.unitPrice").isFloat({ min: 0 }).withMessage("Unit price cannot be negative"),
    body("items.*.unit").optional({ values: "falsy" }).trim().isLength({ max: 30 }),
    body("items.*.productId").optional({ values: "falsy" }).isUUID(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      if (!req.user.branchId) {
        throw new StockError("Your account has no branch, so this quotation cannot be saved");
      }

      const {
        quotationNumber,
        customerId,
        customerName,
        customerPhone,
        customerEmail,
        notes,
        items,
      } = req.body;
      const reduceInventory = wantsInventoryReduction(req.body.reduceInventory);

      const lines = items.map((item, index) => ({
        position: index,
        productId: item.productId || null,
        description: String(item.description).trim(),
        unit: String(item.unit || "pcs").trim() || "pcs",
        quantity: parseFloat(item.quantity),
        unitPrice: parseFloat(item.unitPrice),
      }));

      let customer = null;
      if (customerId) {
        customer = await assertForBusiness(
          db.Customer,
          customerId,
          req.user.businessId,
          "Customer"
        );
      } else if (customerPhone) {
        const compact = String(customerPhone).trim().replace(/[\s()-]/g, "");
        const phones = new Set([String(customerPhone).trim(), compact]);
        if (/^0\d{10}$/.test(compact)) phones.add(`+234${compact.slice(1)}`);
        if (/^\+234\d{10}$/.test(compact)) phones.add(`0${compact.slice(4)}`);
        if (/^234\d{10}$/.test(compact)) {
          phones.add(`+${compact}`);
          phones.add(`0${compact.slice(3)}`);
        }
        customer = await db.Customer.findOne({
          where: {
            phone: [...phones].filter(Boolean),
            businessId: req.user.businessId,
          },
          transaction,
        });
      }

      if (!customer) {
        customer = await db.Customer.create(
          {
            businessId: req.user.businessId,
            name: String(customerName).trim(),
            phone: blankToNull(customerPhone),
            email: blankToNull(customerEmail),
          },
          { transaction }
        );
      }

      let number = String(quotationNumber || "").trim();
      if (number) {
        const existing = await db.Quotation.findOne({
          where: {
            businessId: req.user.businessId,
            quotationNumber: number,
          },
          transaction,
        });
        if (existing) {
          throw new StockError("That quotation number is already used");
        }
      } else {
        const count =
          (await db.Quotation.count({
            where: {
              businessId: req.user.businessId,
              branchId: req.user.branchId,
            },
            transaction,
          })) + 1;
        number = generateBusinessNumber(req.user.businessId, "QT", count);
      }

      const business = await db.Business.findByPk(req.user.businessId, { transaction });
      const totals = calculateTransactionTotals(
        lines,
        resolveTaxRate(business, undefined)
      );

      const changedProductIds = reduceInventory
        ? await applyStockChange({
            items: lines,
            businessId: req.user.businessId,
            branchId: req.user.branchId,
            direction: -1,
            transaction,
          })
        : [];

      const quotation = await db.Quotation.create(
        {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          customerId: customer.id,
          createdBy: req.user.id,
          quotationNumber: number,
          date: new Date().toISOString().split("T")[0],
          customerName: String(customerName).trim(),
          customerPhone: blankToNull(customerPhone),
          customerEmail: blankToNull(customerEmail),
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          total: totals.total,
          notes: blankToNull(notes),
          status: "open",
          inventoryReduced: changedProductIds.length > 0,
        },
        { transaction }
      );

      await db.QuotationItem.bulkCreate(
        lines.map((line) => ({
          quotationId: quotation.id,
          position: line.position,
          productId: line.productId,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: line.quantity * line.unitPrice,
        })),
        { transaction }
      );

      await transaction.commit();

      if (changedProductIds.length) {
        publishStock(req.user.businessId, changedProductIds).catch((error) => {
          console.error("Storefront stock publish failed:", error.message);
        });
      }

      const complete = await db.Quotation.findByPk(quotation.id, {
        include: quotationInclude(),
      });

      const message = changedProductIds.length
        ? "Quotation saved and inventory reduced"
        : reduceInventory
        ? "Quotation saved. None of these items are tracked in inventory"
        : "Quotation saved";

      res.status(201).json(successResponse(message, { quotation: complete }));
    } catch (error) {
      if (!transaction.finished) await transaction.rollback();
      if (error instanceof StockError) {
        return res.status(error.statusCode).json(errorResponse(error.message));
      }
      if (handleTenantError(res, error)) return;
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json(errorResponse("That quotation number is already used"));
      }
      console.error("Quotation creation error:", error);
      res.status(500).json(errorResponse("Failed to save quotation", error.message));
    }
  }
);

router.post(
  "/:id/cancel",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const quotation = await db.Quotation.findOne({
        where: {
          id: req.params.id,
          businessId: req.user.businessId,
          branchId: req.user.branchId,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!quotation) {
        await transaction.rollback();
        return res.status(404).json(errorResponse("Quotation not found"));
      }

      if (quotation.status === "cancelled") {
        await transaction.rollback();
        return res.status(400).json(errorResponse("This quotation is already cancelled"));
      }

      const items = await db.QuotationItem.findAll({
        where: { quotationId: quotation.id },
        transaction,
      });

      let restored = [];
      if (quotation.inventoryReduced) {
        restored = await applyStockChange({
          items,
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          direction: 1,
          transaction,
        });
      }

      await quotation.update(
        {
          status: "cancelled",
          inventoryReduced: false,
        },
        { transaction }
      );

      await transaction.commit();

      if (restored.length) {
        publishStock(req.user.businessId, restored).catch((error) => {
          console.error("Storefront stock publish failed:", error.message);
        });
      }

      const complete = await db.Quotation.findByPk(quotation.id, {
        include: quotationInclude(),
      });

      res.json(
        successResponse(
          restored.length
            ? "Quotation cancelled and inventory restored"
            : "Quotation cancelled",
          { quotation: complete }
        )
      );
    } catch (error) {
      if (!transaction.finished) await transaction.rollback();
      if (error instanceof StockError) {
        return res.status(error.statusCode).json(errorResponse(error.message));
      }
      console.error("Quotation cancel error:", error);
      res.status(500).json(errorResponse("Failed to cancel quotation", error.message));
    }
  }
);

module.exports = router;
