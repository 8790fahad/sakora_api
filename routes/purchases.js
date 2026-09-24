const express = require("express");
const { body, query } = require("express-validator");
const {
  validationRules,
  handleValidationErrors,
} = require("../utils/validation");
const {
  errorResponse,
  successResponse,
  getPagination,
  getPagingData,
  generateBusinessNumber,
  resolveTaxRate,
  updateCashBalance,
} = require("../utils/helpers");
const { authenticate, authorize } = require("../middleware/auth");
const db = require("../models");

const router = express.Router();

// Get all purchases with pagination and filters
router.get(
  "/",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().trim(),
    query("supplier").optional().isUUID(),
    query("status").optional().isIn(["paid", "pending", "overdue"]),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("sortBy").optional().isIn(["date", "totalAmount", "supplier"]),
    query("sortOrder").optional().isIn(["asc", "desc"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        supplier,
        status,
        dateFrom,
        dateTo,
        sortBy = "date",
        sortOrder = "desc",
      } = req.query;

      const { offset, limit: pageLimit } = getPagination(page, limit);

      // Build where clause
      const where = { businessId: req.user.businessId };

      if (search) {
        where[db.Sequelize.Op.or] = [
          { reference: { [db.Sequelize.Op.like]: `%${search}%` } },
          { notes: { [db.Sequelize.Op.like]: `%${search}%` } },
        ];
      }

      if (supplier) {
        where.supplierId = supplier;
      }

      if (status) {
        where.paymentStatus = status;
      }

      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) where.date[db.Sequelize.Op.gte] = new Date(dateFrom);
        if (dateTo) where.date[db.Sequelize.Op.lte] = new Date(dateTo);
      }

      const purchases = await db.Purchase.findAndCountAll({
        where,
        include: [
          {
            model: db.Supplier,
            as: "supplier",
            attributes: ["id", "name", "phone", "email"],
          },
          {
            model: db.Branch,
            as: "branch",
            attributes: ["id", "name"],
          },
          {
            model: db.User,
            as: "creator",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: db.PurchaseItem,
            as: "items",
            include: [
              {
                model: db.Product,
                as: "product",
                attributes: ["id", "name", "sku", "unit"],
              },
            ],
          },
        ],
        order: [
          sortBy === "supplier"
            ? [{ model: db.Supplier, as: "supplier" }, "name", sortOrder.toUpperCase()]
            : [sortBy === "totalAmount" ? "total" : sortBy, sortOrder.toUpperCase()],
        ],
        limit: pageLimit,
        offset,
        distinct: true,
      });

      const response = getPagingData(
        purchases.rows,
        page,
        pageLimit,
        purchases.count
      );

      res.json(successResponse("Purchases retrieved successfully", response));
    } catch (error) {
      console.error("Purchases list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve purchases", error.message));
    }
  }
);

// Get single purchase details
router.get(
  "/:id",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const { id } = req.params;

      const purchase = await db.Purchase.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
        include: [
          {
            model: db.Supplier,
            as: "supplier",
            attributes: ["id", "name", "phone", "email", "address"],
          },
          {
            model: db.Branch,
            as: "branch",
            attributes: ["id", "name"],
          },
          {
            model: db.User,
            as: "creator",
            attributes: ["id", "firstName", "lastName", "email"],
          },
          {
            model: db.PurchaseItem,
            as: "items",
            include: [
              {
                model: db.Product,
                as: "product",
                attributes: ["id", "name", "sku", "unit", "image"],
                include: [
                  {
                    model: db.Category,
                    as: "category",
                    attributes: ["id", "name", "color"],
                  },
                ],
              },
            ],
          },
        ],
      });

      if (!purchase) {
        return res.status(404).json(errorResponse("Purchase not found"));
      }

      res.json(
        successResponse("Purchase retrieved successfully", { purchase })
      );
    } catch (error) {
      console.error("Purchase details error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve purchase", error.message));
    }
  }
);

// Create new purchase
router.post(
  "/",
  [
    authenticate,
    authorize(["owner", "manager", "staff"]),
    body("supplierId").optional().isUUID(),
    body("supplierName").optional().trim().isLength({ min: 2, max: 100 }),
    body("date").isISO8601(),
    body("reference").optional().trim().isLength({ max: 50 }),
    body("paymentMethod").isIn(["cash", "bank_transfer", "cheque", "credit"]),
    body("paymentStatus")
      .optional()
      .isIn(["paid", "pending", "partial", "overdue"]),
    body("items").isArray({ min: 1 }),
    body("items.*.productId").isUUID(),
    body("items.*.quantity").isFloat({ min: 0.001 }),
    body("items.*.unitCost").isFloat({ min: 0 }),
    body("discount").optional().isFloat({ min: 0 }),
    body("tax").optional().isFloat({ min: 0 }),
    body("taxRate").optional().isFloat({ min: 0, max: 100 }),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const {
        supplierId,
        supplierName,
        date,
        reference,
        paymentMethod,
        paymentStatus = paymentMethod === "credit" ? "pending" : "paid",
        items,
        discount = 0,
        tax = 0,
        taxRate,
        notes,
      } = req.body;

      // Handle supplier creation if new
      let finalSupplierId = supplierId;
      if (!supplierId && supplierName) {
        const newSupplier = await db.Supplier.create(
          {
            businessId: req.user.businessId,
            name: supplierName,
          },
          { transaction }
        );
        finalSupplierId = newSupplier.id;
      }

      const subtotal = items.reduce(
        (sum, item) => sum + parseFloat(item.quantity) * parseFloat(item.unitCost),
        0
      );
      const business = await db.Business.findByPk(req.user.businessId);
      const appliedTaxRate = resolveTaxRate(business, taxRate);
      let taxAmount = parseFloat(tax || 0);
      if (!taxAmount && appliedTaxRate > 0) {
        taxAmount = (subtotal * appliedTaxRate) / 100;
      }
      const totalAmount = subtotal + taxAmount - parseFloat(discount);

      const count = await db.Purchase.count({
        where: { businessId: req.user.businessId },
      });
      const purchaseNumber =
        reference || generateBusinessNumber(req.user.businessId, "PUR", count + 1);

      const methodMap = {
        cash: "cash",
        bank_transfer: "bank",
        bank: "bank",
        cheque: "cheque",
        credit: "credit",
        mobile: "mobile",
        other: "other",
      };
      const statusMap = {
        paid: "paid",
        pending: "unpaid",
        unpaid: "unpaid",
        partial: "partial",
        overdue: "unpaid",
      };
      const mappedMethod = methodMap[paymentMethod] || "cash";
      const mappedStatus = statusMap[paymentStatus] || "unpaid";

      const purchase = await db.Purchase.create(
        {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          supplierId: finalSupplierId,
          purchaseNumber,
          date: new Date(date),
          reference: purchaseNumber,
          subtotal,
          discountAmount: parseFloat(discount),
          taxAmount,
          total: totalAmount,
          paidAmount: mappedStatus === "paid" ? totalAmount : 0,
          paymentMethod: mappedMethod,
          paymentStatus: mappedStatus,
          notes,
          createdBy: req.user.id,
        },
        { transaction }
      );

      // Create purchase items and update inventory
      for (const item of items) {
        const { productId, quantity, unitCost } = item;

        // Create purchase item
        await db.PurchaseItem.create(
          {
            purchaseId: purchase.id,
            productId,
            quantity: parseFloat(quantity),
            unitCost: parseFloat(unitCost),
            totalCost: parseFloat(quantity) * parseFloat(unitCost),
          },
          { transaction }
        );

        // Update inventory
        const inventory = await db.Inventory.findOne({
          where: {
            productId,
            branchId: req.user.branchId,
          },
        });

        if (inventory) {
          // Update existing inventory
          const newQuantity = parseFloat(inventory.quantity) + parseFloat(quantity);
          const newAvgCost = (
            (parseFloat(inventory.quantity) * parseFloat(inventory.averageCostPrice) +
              parseFloat(quantity) * parseFloat(unitCost)) /
            newQuantity
          );

          await inventory.update(
            {
              quantity: newQuantity,
              averageCostPrice: newAvgCost,
              lastStockUpdate: new Date(),
            },
            { transaction }
          );
        } else {
          // Create new inventory record
          await db.Inventory.create(
            {
              productId,
              branchId: req.user.branchId,
              quantity: parseFloat(quantity),
              averageCostPrice: parseFloat(unitCost),
              reorderPoint: 10, // Default
              lastStockUpdate: new Date(),
            },
            { transaction }
          );
        }
      }

      // Create cash transaction if paid
      if (mappedStatus === "paid" && mappedMethod !== "credit") {
        const runningBalance = await updateCashBalance(
          req.user.branchId,
          totalAmount,
          "out",
          db
        );

        await db.CashTransaction.create(
          {
            businessId: req.user.businessId,
            branchId: req.user.branchId,
            type: "out",
            amount: totalAmount,
            description: `Purchase - ${purchaseNumber}${
              finalSupplierId ? "" : ` (${supplierName})`
            }`,
            referenceType: "purchase",
            referenceId: purchase.id,
            referenceNumber: purchaseNumber,
            paymentMethod: mappedMethod,
            runningBalance,
            notes,
            createdBy: req.user.id,
          },
          { transaction }
        );
      }

      await transaction.commit();

      // Return purchase with full details
      const purchaseWithDetails = await db.Purchase.findByPk(purchase.id, {
        include: [
          { model: db.Supplier, as: "supplier" },
          { model: db.Branch, as: "branch" },
          { model: db.User, as: "creator" },
          {
            model: db.PurchaseItem,
            as: "items",
            include: [{ model: db.Product, as: "product" }],
          },
        ],
      });

      res.status(201).json(
        successResponse("Purchase created successfully", {
          purchase: purchaseWithDetails,
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Purchase creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create purchase", error.message));
    }
  }
);

// Update purchase payment status
router.patch(
  "/:id/payment",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    body("paymentStatus").isIn(["paid", "pending", "partial", "overdue"]),
    body("amountPaid").optional().isFloat({ min: 0 }),
    body("paymentMethod").optional().isIn([
      "cash",
      "bank_transfer",
      "cheque",
      "credit",
    ]),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { id } = req.params;
      const { paymentStatus, amountPaid, paymentMethod, notes } = req.body;

      const purchase = await db.Purchase.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!purchase) {
        await transaction.rollback();
        return res.status(404).json(errorResponse("Purchase not found"));
      }

      const updates = { paymentStatus };
      if (paymentMethod) updates.paymentMethod = paymentMethod;
      if (notes) updates.notes = notes;

      await purchase.update(updates, { transaction });

      // Create cash transaction for payment
      if (paymentStatus === "paid" && amountPaid) {
        const runningBalance = await updateCashBalance(
          req.user.branchId,
          parseFloat(amountPaid),
          "out",
          db
        );

        await db.CashTransaction.create(
          {
            businessId: req.user.businessId,
            branchId: req.user.branchId,
            type: "out",
            amount: parseFloat(amountPaid),
            description: `Purchase payment - ${purchase.reference}`,
            referenceType: "purchase_payment",
            referenceId: purchase.id,
            referenceNumber: purchase.reference,
            paymentMethod: paymentMethod || purchase.paymentMethod,
            runningBalance,
            notes,
            createdBy: req.user.id,
          },
          { transaction }
        );
      }

      await transaction.commit();

      // Return updated purchase
      const updatedPurchase = await db.Purchase.findByPk(id, {
        include: [
          { model: db.Supplier, as: "supplier" },
          { model: db.Branch, as: "branch" },
          { model: db.User, as: "creator" },
        ],
      });

      res.json(
        successResponse("Purchase payment updated successfully", {
          purchase: updatedPurchase,
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Purchase payment update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update purchase payment", error.message));
    }
  }
);

// Delete purchase (only if not paid)
router.delete(
  "/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { id } = req.params;

      const purchase = await db.Purchase.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
        include: [
          {
            model: db.PurchaseItem,
            as: "items",
          },
        ],
      });

      if (!purchase) {
        await transaction.rollback();
        return res.status(404).json(errorResponse("Purchase not found"));
      }

      if (purchase.paymentStatus === "paid") {
        await transaction.rollback();
        return res
          .status(400)
          .json(
            errorResponse(
              "Cannot delete paid purchase. Update payment status first."
            )
          );
      }

      // Reverse inventory changes
      for (const item of purchase.items) {
        const inventory = await db.Inventory.findOne({
          where: {
            productId: item.productId,
            branchId: req.user.branchId,
          },
        });

        if (inventory) {
          const newQuantity = parseFloat(inventory.quantity) - parseFloat(item.quantity);
          if (newQuantity < 0) {
            await transaction.rollback();
            return res
              .status(400)
              .json(
                errorResponse(
                  "Cannot delete purchase - would result in negative inventory"
                )
              );
          }

          await inventory.update(
            {
              quantity: newQuantity,
              lastStockUpdate: new Date(),
            },
            { transaction }
          );
        }
      }

      // Delete purchase items first
      await db.PurchaseItem.destroy({
        where: { purchaseId: id },
        transaction,
      });

      // Delete purchase
      await purchase.destroy({ transaction });

      await transaction.commit();

      res.json(successResponse("Purchase deleted successfully"));
    } catch (error) {
      await transaction.rollback();
      console.error("Purchase deletion error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to delete purchase", error.message));
    }
  }
);

// Get purchase summary/stats
router.get("/summary/stats", authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.date = {};
      if (dateFrom) dateFilter.date[db.Sequelize.Op.gte] = new Date(dateFrom);
      if (dateTo) dateFilter.date[db.Sequelize.Op.lte] = new Date(dateTo);
    }

    const [totalPurchases, totalAmount, pendingAmount, stats] = await Promise.all([
      // Total purchase count
      db.Purchase.count({
        where: {
          businessId: req.user.businessId,
          ...dateFilter,
        },
      }),

      // Total purchase amount
      db.Purchase.sum("total", {
        where: {
          businessId: req.user.businessId,
          paymentStatus: "paid",
          ...dateFilter,
        },
      }),

      // Pending payment amount
      db.Purchase.sum("total", {
        where: {
          businessId: req.user.businessId,
          paymentStatus: ["pending", "overdue"],
          ...dateFilter,
        },
      }),

      // Purchase stats by status
      db.Purchase.findAll({
        where: {
          businessId: req.user.businessId,
          ...dateFilter,
        },
        attributes: [
          "paymentStatus",
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
          [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
        ],
        group: ["paymentStatus"],
      }),
    ]);

    const summary = {
      totalPurchases,
      totalAmount: totalAmount || 0,
      pendingAmount: pendingAmount || 0,
      paidAmount: (totalAmount || 0) - (pendingAmount || 0),
      byStatus: stats.reduce((acc, stat) => {
        acc[stat.paymentStatus] = {
          count: parseInt(stat.get("count")),
          amount: parseFloat(stat.get("amount")) || 0,
        };
        return acc;
      }, {}),
    };

    res.json(
      successResponse("Purchase summary retrieved successfully", { summary })
    );
  } catch (error) {
    console.error("Purchase summary error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve purchase summary", error.message));
  }
});

module.exports = router;
