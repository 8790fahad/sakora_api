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
  updateCashBalance,
  getPagination,
  getPagingData,
} = require("../utils/helpers");
const { authenticate, authorize } = require("../middleware/auth");
const db = require("../models");

const router = express.Router();

// Get all sales with pagination and filters
router.get(
  "/",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("startDate").optional().isISO8601(),
    query("endDate").optional().isISO8601(),
    query("customerId").optional().isUUID(),
    query("paymentStatus")
      .optional()
      .isIn(["paid", "partial", "unpaid", "all"]),
    query("status")
      .optional()
      .isIn(["completed", "pending", "cancelled", "refunded", "all"]),
    query("sortBy").optional().isIn(["date", "total", "createdAt"]),
    query("sortOrder").optional().isIn(["asc", "desc"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        startDate,
        endDate,
        customerId,
        paymentStatus = "all",
        status = "all",
        sortBy = "date",
        sortOrder = "desc",
      } = req.query;

      const { offset, limit: pageLimit } = getPagination(page, limit);

      // Build where clause
      const where = { branchId: req.user.branchId };

      // Date filtering
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date[db.Sequelize.Op.gte] = startDate;
        if (endDate) where.date[db.Sequelize.Op.lte] = endDate;
      }

      if (customerId) {
        where.customerId = customerId;
      }

      if (paymentStatus !== "all") {
        where.paymentStatus = paymentStatus;
      }

      if (status !== "all") {
        where.status = status;
      }

      const sales = await db.Sale.findAndCountAll({
        where,
        include: [
          {
            model: db.Customer,
            as: "customer",
            attributes: ["id", "name", "phone"],
          },
          {
            model: db.User,
            as: "creator",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: db.SaleItem,
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
          sortBy === "date"
            ? ["date", sortOrder.toUpperCase()]
            : sortBy === "total"
            ? ["total", sortOrder.toUpperCase()]
            : ["createdAt", sortOrder.toUpperCase()],
        ],
        limit: pageLimit,
        offset,
        distinct: true,
      });

      const response = getPagingData(sales.rows, page, pageLimit, sales.count);

      // Add computed fields
      response.items = response.items.map((sale) => ({
        ...sale.toJSON(),
        balanceDue: sale.getBalanceDue(),
        isFullyPaid: sale.isFullyPaid(),
        itemCount: sale.items.length,
        totalProfit: sale.items.reduce(
          (sum, item) => sum + (parseFloat(item.profit) || 0),
          0
        ),
      }));

      res.json(successResponse("Sales retrieved successfully", response));
    } catch (error) {
      console.error("Sales list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve sales", error.message));
    }
  }
);

// Get single sale with full details
router.get(
  "/:id",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const { id } = req.params;

      const sale = await db.Sale.findOne({
        where: {
          id,
          branchId: req.user.branchId,
        },
        include: [
          {
            model: db.Customer,
            as: "customer",
          },
          {
            model: db.User,
            as: "creator",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: db.Branch,
            as: "branch",
            attributes: ["id", "name"],
          },
          {
            model: db.SaleItem,
            as: "items",
            include: [
              {
                model: db.Product,
                as: "product",
                attributes: ["id", "name", "sku", "unit", "image"],
              },
            ],
          },
          {
            model: db.CashTransaction,
            as: "transactions",
          },
        ],
      });

      if (!sale) {
        return res.status(404).json(errorResponse("Sale not found"));
      }

      const saleData = {
        ...sale.toJSON(),
        balanceDue: sale.getBalanceDue(),
        isFullyPaid: sale.isFullyPaid(),
        totalProfit: sale.items.reduce(
          (sum, item) => sum + (parseFloat(item.profit) || 0),
          0
        ),
      };

      res.json(
        successResponse("Sale retrieved successfully", { sale: saleData })
      );
    } catch (error) {
      console.error("Sale details error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve sale", error.message));
    }
  }
);

// Create new sale
router.post(
  "/",
  [
    authenticate,
    ...validationRules.saleCreation,
    body("customerId").optional().isUUID(),
    body("customerName").optional().trim().isLength({ min: 2, max: 100 }),
    body("customerPhone").optional().isMobilePhone(),
    body("discountAmount").optional().isFloat({ min: 0 }),
    body("taxRate").optional().isFloat({ min: 0, max: 100 }),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const {
        items,
        customerId,
        customerName,
        customerPhone,
        customerEmail,
        paymentMethod = "cash",
        paidAmount,
        discountAmount = 0,
        taxRate = 0,
        notes,
      } = req.body;

      // Validate items and check stock availability
      const productIds = items.map((item) => item.productId);
      const products = await db.Product.findAll({
        where: {
          id: productIds,
          businessId: req.user.businessId,
          status: "active",
        },
        include: [
          {
            model: db.Inventory,
            as: "inventory",
            where: { branchId: req.user.branchId },
            required: false,
          },
        ],
      });

      if (products.length !== productIds.length) {
        await transaction.rollback();
        return res
          .status(400)
          .json(errorResponse("One or more products not found"));
      }

      // Check stock availability for each item
      for (const item of items) {
        const product = products.find((p) => p.id === item.productId);
        const inventory = product.inventory?.[0];

        if (product.trackInventory && inventory) {
          const available =
            parseFloat(inventory.quantity) -
            parseFloat(inventory.reservedQuantity || 0);
          if (available < parseFloat(item.quantity)) {
            await transaction.rollback();
            return res
              .status(400)
              .json(
                errorResponse(
                  `Insufficient stock for ${product.name}. Available: ${available} ${product.unit}`
                )
              );
          }
        }
      }

      // Create customer if provided but doesn't exist
      let customer = null;
      if (customerId) {
        customer = await db.Customer.findByPk(customerId);
      } else if (customerName || customerPhone) {
        // Try to find existing customer by phone
        if (customerPhone) {
          customer = await db.Customer.findOne({
            where: {
              phone: customerPhone,
              businessId: req.user.businessId,
            },
          });
        }

        // Create new customer if not found
        if (!customer && (customerName || customerPhone)) {
          customer = await db.Customer.create(
            {
              businessId: req.user.businessId,
              name: customerName || "Walk-in Customer",
              phone: customerPhone,
              email: customerEmail,
            },
            { transaction }
          );
        }
      }

      // Generate sale number
      const saleCount =
        (await db.Sale.count({
          where: { branchId: req.user.branchId },
        })) + 1;
      const saleNumber = generateBusinessNumber(
        req.user.businessId,
        "SAL",
        saleCount
      );

      const business = await db.Business.findByPk(req.user.businessId);
      const appliedTaxRate = resolveTaxRate(business, taxRate);
      const totals = calculateTransactionTotals(items, appliedTaxRate);
      const finalTotal = totals.total - parseFloat(discountAmount);

      // Create sale
      const sale = await db.Sale.create(
        {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          customerId: customer?.id,
          createdBy: req.user.id,
          saleNumber,
          date: new Date().toISOString().split("T")[0],
          time: new Date().toTimeString().split(" ")[0],
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discountAmount: parseFloat(discountAmount),
          total: finalTotal,
          paidAmount: parseFloat(paidAmount),
          changeAmount: Math.max(0, parseFloat(paidAmount) - finalTotal),
          paymentMethod,
          paymentStatus:
            parseFloat(paidAmount) >= finalTotal
              ? "paid"
              : parseFloat(paidAmount) > 0
              ? "partial"
              : "unpaid",
          status: "completed",
          notes,
          customerPhone,
          customerEmail,
        },
        { transaction }
      );

      // Create sale items and update inventory
      for (const itemData of items) {
        const product = products.find((p) => p.id === itemData.productId);
        const quantity = parseFloat(itemData.quantity);
        const unitPrice = parseFloat(itemData.unitPrice);
        const discountAmount = parseFloat(itemData.discountAmount || 0);
        const totalPrice = quantity * unitPrice - discountAmount;

        // Calculate profit
        const costPrice = parseFloat(product.costPrice || 0);
        const profit = totalPrice - quantity * costPrice;

        // Create sale item
        await db.SaleItem.create(
          {
            saleId: sale.id,
            productId: product.id,
            quantity,
            unitPrice,
            totalPrice,
            discountAmount,
            costPrice,
            profit,
            notes: itemData.notes,
          },
          { transaction }
        );

        // Update inventory if product tracks inventory
        if (product.trackInventory) {
          const inventory = product.inventory?.[0];
          if (inventory) {
            const newQuantity = parseFloat(inventory.quantity) - quantity;
            await inventory.update(
              {
                quantity: Math.max(0, newQuantity),
                lastStockUpdate: new Date(),
              },
              { transaction }
            );
          }
        }
      }

      // Create cash transaction for payment
      if (parseFloat(paidAmount) > 0) {
        const runningBalance = await updateCashBalance(
          req.user.branchId,
          parseFloat(paidAmount),
          "in",
          db
        );

        await db.CashTransaction.create(
          {
            businessId: req.user.businessId,
            branchId: req.user.branchId,
            type: "in",
            amount: parseFloat(paidAmount),
            description: `Sale payment - ${saleNumber}`,
            referenceType: "sale",
            referenceId: sale.id,
            referenceNumber: saleNumber,
            paymentMethod,
            runningBalance,
            createdBy: req.user.id,
          },
          { transaction }
        );
      }

      // Update customer balance if credit sale
      if (customer && parseFloat(paidAmount) < finalTotal) {
        const balanceDue = finalTotal - parseFloat(paidAmount);
        await customer.update(
          {
            currentBalance:
              parseFloat(customer.currentBalance || 0) + balanceDue,
          },
          { transaction }
        );
      }

      await transaction.commit();

      // Get complete sale data for response
      const completeSale = await db.Sale.findByPk(sale.id, {
        include: [
          { model: db.Customer, as: "customer" },
          {
            model: db.SaleItem,
            as: "items",
            include: [{ model: db.Product, as: "product" }],
          },
        ],
      });

      res
        .status(201)
        .json(
          successResponse("Sale created successfully", { sale: completeSale })
        );
    } catch (error) {
      await transaction.rollback();
      console.error("Sale creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create sale", error.message));
    }
  }
);

// Update sale (limited fields)
router.put(
  "/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    body("notes").optional().trim(),
    body("status").optional().isIn(["completed", "pending", "cancelled"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes, status } = req.body;

      const sale = await db.Sale.findOne({
        where: {
          id,
          branchId: req.user.branchId,
        },
      });

      if (!sale) {
        return res.status(404).json(errorResponse("Sale not found"));
      }

      // Only allow certain updates after sale is created
      const updateData = {};
      if (notes !== undefined) updateData.notes = notes;
      if (status !== undefined && sale.status !== "completed") {
        updateData.status = status;
      }

      await sale.update(updateData);

      const updatedSale = await db.Sale.findByPk(id, {
        include: [
          { model: db.Customer, as: "customer" },
          {
            model: db.SaleItem,
            as: "items",
            include: [{ model: db.Product, as: "product" }],
          },
        ],
      });

      res.json(
        successResponse("Sale updated successfully", { sale: updatedSale })
      );
    } catch (error) {
      console.error("Sale update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update sale", error.message));
    }
  }
);

// Get sales statistics
router.get(
  "/stats/summary",
  [
    authenticate,
    query("startDate").optional().isISO8601(),
    query("endDate").optional().isISO8601(),
    query("period").optional().isIn(["today", "week", "month", "year"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { startDate, endDate, period = "today" } = req.query;

      // Determine date range
      let dateFilter = {};
      const now = new Date();

      if (startDate && endDate) {
        dateFilter = {
          date: {
            [db.Sequelize.Op.between]: [startDate, endDate],
          },
        };
      } else if (period) {
        switch (period) {
          case "today":
            dateFilter = {
              date: now.toISOString().split("T")[0],
            };
            break;
          case "week":
            const weekStart = new Date(
              now.setDate(now.getDate() - now.getDay())
            );
            dateFilter = {
              date: {
                [db.Sequelize.Op.gte]: weekStart.toISOString().split("T")[0],
              },
            };
            break;
          case "month":
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            dateFilter = {
              date: {
                [db.Sequelize.Op.gte]: monthStart.toISOString().split("T")[0],
              },
            };
            break;
          case "year":
            const yearStart = new Date(now.getFullYear(), 0, 1);
            dateFilter = {
              date: {
                [db.Sequelize.Op.gte]: yearStart.toISOString().split("T")[0],
              },
            };
            break;
        }
      }

      const sales = await db.Sale.findAll({
        where: {
          branchId: req.user.branchId,
          status: "completed",
          ...dateFilter,
        },
        include: [
          {
            model: db.SaleItem,
            as: "items",
            attributes: ["quantity", "totalPrice", "profit"],
          },
        ],
      });

      // Calculate statistics
      const stats = {
        totalSales: sales.length,
        totalRevenue: sales.reduce(
          (sum, sale) => sum + parseFloat(sale.total),
          0
        ),
        totalProfit: sales.reduce(
          (sum, sale) =>
            sum +
            sale.items.reduce(
              (itemSum, item) => itemSum + parseFloat(item.profit || 0),
              0
            ),
          0
        ),
        averageOrderValue:
          sales.length > 0
            ? sales.reduce((sum, sale) => sum + parseFloat(sale.total), 0) /
              sales.length
            : 0,
        totalItemsSold: sales.reduce(
          (sum, sale) =>
            sum +
            sale.items.reduce(
              (itemSum, item) => itemSum + parseFloat(item.quantity),
              0
            ),
          0
        ),
        cashSales: sales.filter((sale) => sale.paymentMethod === "cash").length,
        creditSales: sales.filter((sale) => sale.paymentStatus !== "paid")
          .length,
        paidAmount: sales.reduce(
          (sum, sale) => sum + parseFloat(sale.paidAmount),
          0
        ),
        outstandingAmount: sales.reduce(
          (sum, sale) => sum + sale.getBalanceDue(),
          0
        ),
      };

      // Add profit margin
      stats.profitMargin =
        stats.totalRevenue > 0
          ? (stats.totalProfit / stats.totalRevenue) * 100
          : 0;

      res.json(
        successResponse("Sales statistics retrieved successfully", {
          stats,
          period,
        })
      );
    } catch (error) {
      console.error("Sales stats error:", error);
      res
        .status(500)
        .json(
          errorResponse("Failed to retrieve sales statistics", error.message)
        );
    }
  }
);

// Generate receipt for a sale
router.get(
  "/:id/receipt",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const { id } = req.params;

      const sale = await db.Sale.findOne({
        where: {
          id,
          branchId: req.user.branchId,
        },
        include: [
          {
            model: db.Customer,
            as: "customer",
          },
          {
            model: db.Branch,
            as: "branch",
            include: [
              {
                model: db.Business,
                as: "business",
              },
            ],
          },
          {
            model: db.SaleItem,
            as: "items",
            include: [
              {
                model: db.Product,
                as: "product",
              },
            ],
          },
          {
            model: db.User,
            as: "creator",
            attributes: ["firstName", "lastName"],
          },
        ],
      });

      if (!sale) {
        return res.status(404).json(errorResponse("Sale not found"));
      }

      // Mark receipt as generated
      await sale.update({
        receiptGenerated: true,
        receiptNumber: sale.receiptNumber || sale.saleNumber,
      });

      const receiptData = {
        ...sale.toJSON(),
        balanceDue: sale.getBalanceDue(),
        isFullyPaid: sale.isFullyPaid(),
        generatedAt: new Date().toISOString(),
      };

      res.json(
        successResponse("Receipt data retrieved successfully", {
          receipt: receiptData,
        })
      );
    } catch (error) {
      console.error("Receipt generation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to generate receipt", error.message));
    }
  }
);

module.exports = router;
