const express = require("express");
const { query } = require("express-validator");
const { validationRules, handleValidationErrors } = require("../utils/validation");
const { errorResponse, successResponse } = require("../utils/helpers");
const { authenticate } = require("../middleware/auth");
const db = require("../models");
const {
  assertBranchInBusiness,
  handleTenantError,
} = require("../utils/tenant");

const router = express.Router();

async function resolveReportBranchId(req) {
  const { branchId } = req.query;
  if (!branchId) return null;
  await assertBranchInBusiness(branchId, req.user.businessId);
  return branchId;
}

// Sales Report
router.get(
  "/sales",
  [
    authenticate,
    query("period").optional().isIn(["day", "week", "month", "quarter", "year", "custom"]),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("branchId").optional().isUUID(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { period = "month", dateFrom, dateTo } = req.query;
      const branchId = await resolveReportBranchId(req);

      // Calculate date range
      let startDate, endDate;
      const now = new Date();

      if (period === "custom" && dateFrom && dateTo) {
        startDate = new Date(dateFrom);
        endDate = new Date(dateTo);
      } else {
        endDate = now;
        switch (period) {
          case "day":
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case "week":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case "quarter":
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            startDate = new Date(now.getFullYear(), quarterStart, 1);
            break;
          case "year":
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
          default:
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
      }

      const whereClause = {
        businessId: req.user.businessId,
        date: {
          [db.Sequelize.Op.between]: [startDate, endDate],
        },
      };

      if (branchId) {
        whereClause.branchId = branchId;
      }

      // Get sales summary
      const [
        totalSales,
        totalRevenue,
        salesByPaymentMethod,
        salesByCustomer,
        topProducts,
        dailySalesChart,
      ] = await Promise.all([
        // Total sales count
        db.Sale.count({ where: whereClause }),

        // Total revenue
        db.Sale.sum("total", { where: whereClause }),

        // Sales by payment method
        db.Sale.findAll({
          where: whereClause,
          attributes: [
            "paymentMethod",
            [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
          ],
          group: ["paymentMethod"],
        }),

        // Sales by customer
        db.Sale.findAll({
          where: { ...whereClause, customerId: { [db.Sequelize.Op.ne]: null } },
          include: [
            {
              model: db.Customer,
              as: "customer",
              attributes: ["id", "name"],
            },
          ],
          attributes: [
            "customerId",
            [db.sequelize.fn("COUNT", db.sequelize.col("Sale.id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
          ],
          group: ["customerId", "customer.id"],
          order: [[db.sequelize.literal("amount"), "DESC"]],
          limit: 10,
        }),

        // Top selling products
        db.SaleItem.findAll({
          include: [
            {
              model: db.Sale,
              as: "sale",
              where: whereClause,
              attributes: [],
            },
            {
              model: db.Product,
              as: "product",
              attributes: ["id", "name", "sku"],
            },
          ],
          attributes: [
            "productId",
            [db.sequelize.fn("SUM", db.sequelize.col("quantity")), "totalQuantity"],
            // underscored: true → DB column is total_price
            [db.sequelize.fn("SUM", db.sequelize.col("SaleItem.total_price")), "totalRevenue"],
            [db.sequelize.fn("COUNT", db.sequelize.col("SaleItem.id")), "salesCount"],
          ],
          group: ["productId", "product.id"],
          order: [[db.sequelize.literal("totalRevenue"), "DESC"]],
          limit: 10,
        }),

        // Daily sales chart data
        db.Sale.findAll({
          where: whereClause,
          attributes: [
            [db.sequelize.fn("DATE", db.sequelize.col("date")), "date"],
            [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
          ],
          group: [db.sequelize.fn("DATE", db.sequelize.col("date"))],
          order: [[db.sequelize.fn("DATE", db.sequelize.col("date")), "ASC"]],
        }),
      ]);

      const summary = {
        period,
        startDate,
        endDate,
        totalSales,
        totalRevenue: totalRevenue || 0,
        averageSaleValue: totalSales > 0 ? (totalRevenue || 0) / totalSales : 0,
        salesByPaymentMethod: salesByPaymentMethod.reduce((acc, item) => {
          acc[item.paymentMethod] = {
            count: parseInt(item.get("count")),
            amount: parseFloat(item.get("amount")) || 0,
          };
          return acc;
        }, {}),
        salesByCustomer: salesByCustomer.map((item) => ({
          customerId: item.customerId,
          customerName: item.customer?.name || "Unknown",
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
        topProducts: topProducts.map((item) => ({
          productId: item.productId,
          productName: item.product?.name || "Unknown",
          sku: item.product?.sku,
          totalQuantity: parseFloat(item.get("totalQuantity")) || 0,
          totalRevenue: parseFloat(item.get("totalRevenue")) || 0,
          salesCount: parseInt(item.get("salesCount")),
        })),
        dailyChart: dailySalesChart.map((item) => ({
          date: item.get("date"),
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
      };

      res.json(successResponse("Sales report generated successfully", { report: summary }));
    } catch (error) {
      if (handleTenantError(res, error)) return;
      console.error("Sales report error:", error);
      res.status(500).json(errorResponse("Failed to generate sales report", error.message));
    }
  }
);

// Purchase Report
router.get(
  "/purchases",
  [
    authenticate,
    query("period").optional().isIn(["day", "week", "month", "quarter", "year", "custom"]),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("branchId").optional().isUUID(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { period = "month", dateFrom, dateTo, branchId } = req.query;

      // Calculate date range (same logic as sales report)
      let startDate, endDate;
      const now = new Date();

      if (period === "custom" && dateFrom && dateTo) {
        startDate = new Date(dateFrom);
        endDate = new Date(dateTo);
      } else {
        endDate = now;
        switch (period) {
          case "day":
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case "week":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case "quarter":
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            startDate = new Date(now.getFullYear(), quarterStart, 1);
            break;
          case "year":
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
          default:
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
      }

      const whereClause = {
        businessId: req.user.businessId,
        date: {
          [db.Sequelize.Op.between]: [startDate, endDate],
        },
      };

      if (branchId) {
        whereClause.branchId = branchId;
      }

      // Get purchase summary
      const [
        totalPurchases,
        totalSpend,
        purchasesByPaymentMethod,
        purchasesBySupplier,
        topPurchasedProducts,
        outstandingPayments,
      ] = await Promise.all([
        // Total purchases count
        db.Purchase.count({ where: whereClause }),

        // Total spend
        db.Purchase.sum("total", { where: whereClause }),

        // Purchases by payment method
        db.Purchase.findAll({
          where: whereClause,
          attributes: [
            "paymentMethod",
            [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
          ],
          group: ["paymentMethod"],
        }),

        // Purchases by supplier
        db.Purchase.findAll({
          where: { ...whereClause, supplierId: { [db.Sequelize.Op.ne]: null } },
          include: [
            {
              model: db.Supplier,
              as: "supplier",
              attributes: ["id", "name"],
            },
          ],
          attributes: [
            "supplierId",
            [db.sequelize.fn("COUNT", db.sequelize.col("Purchase.id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
          ],
          group: ["supplierId", "supplier.id"],
          order: [[db.sequelize.literal("amount"), "DESC"]],
          limit: 10,
        }),

        // Top purchased products
        db.PurchaseItem.findAll({
          include: [
            {
              model: db.Purchase,
              as: "purchase",
              where: whereClause,
              attributes: [],
            },
            {
              model: db.Product,
              as: "product",
              attributes: ["id", "name", "sku"],
            },
          ],
          attributes: [
            "productId",
            [db.sequelize.fn("SUM", db.sequelize.col("quantity")), "totalQuantity"],
            // underscored: true → DB columns are total_cost / unit_cost
            [db.sequelize.fn("SUM", db.sequelize.col("total_cost")), "totalCost"],
            [db.sequelize.fn("AVG", db.sequelize.col("unit_cost")), "avgUnitCost"],
          ],
          group: ["productId", "product.id"],
          order: [[db.sequelize.literal("totalCost"), "DESC"]],
          limit: 10,
        }),

        // Outstanding payments
        db.Purchase.sum("total", {
          where: {
            businessId: req.user.businessId,
            paymentStatus: ["pending", "partial", "overdue"],
          },
        }),
      ]);

      const summary = {
        period,
        startDate,
        endDate,
        totalPurchases,
        totalSpend: totalSpend || 0,
        averagePurchaseValue: totalPurchases > 0 ? (totalSpend || 0) / totalPurchases : 0,
        outstandingPayments: outstandingPayments || 0,
        purchasesByPaymentMethod: purchasesByPaymentMethod.reduce((acc, item) => {
          acc[item.paymentMethod] = {
            count: parseInt(item.get("count")),
            amount: parseFloat(item.get("amount")) || 0,
          };
          return acc;
        }, {}),
        purchasesBySupplier: purchasesBySupplier.map((item) => ({
          supplierId: item.supplierId,
          supplierName: item.supplier?.name || "Unknown",
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
        topPurchasedProducts: topPurchasedProducts.map((item) => ({
          productId: item.productId,
          productName: item.product?.name || "Unknown",
          sku: item.product?.sku,
          totalQuantity: parseFloat(item.get("totalQuantity")) || 0,
          totalCost: parseFloat(item.get("totalCost")) || 0,
          avgUnitCost: parseFloat(item.get("avgUnitCost")) || 0,
        })),
      };

      res.json(successResponse("Purchase report generated successfully", { report: summary }));
    } catch (error) {
      console.error("Purchase report error:", error);
      res.status(500).json(errorResponse("Failed to generate purchase report", error.message));
    }
  }
);

// Expense Report
router.get(
  "/expenses",
  [
    authenticate,
    query("period").optional().isIn(["day", "week", "month", "quarter", "year", "custom"]),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("branchId").optional().isUUID(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { period = "month", dateFrom, dateTo, branchId } = req.query;

      // Calculate date range (same logic as other reports)
      let startDate, endDate;
      const now = new Date();

      if (period === "custom" && dateFrom && dateTo) {
        startDate = new Date(dateFrom);
        endDate = new Date(dateTo);
      } else {
        endDate = now;
        switch (period) {
          case "day":
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case "week":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case "quarter":
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            startDate = new Date(now.getFullYear(), quarterStart, 1);
            break;
          case "year":
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
          default:
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
      }

      const whereClause = {
        businessId: req.user.businessId,
        date: {
          [db.Sequelize.Op.between]: [startDate, endDate],
        },
      };

      if (branchId) {
        whereClause.branchId = branchId;
      }

      // Get expense summary
      const [
        totalExpenses,
        totalAmount,
        expensesByCategory,
        expensesByPaymentMethod,
        topExpenses,
        dailyExpensesChart,
      ] = await Promise.all([
        // Total expenses count
        db.Expense.count({ where: whereClause }),

        // Total amount
        db.Expense.sum("amount", { where: whereClause }),

        // Expenses by category
        db.Expense.findAll({
          where: whereClause,
          include: [
            {
              model: db.ExpenseCategory,
              as: "category",
              attributes: ["id", "name", "color"],
            },
          ],
          attributes: [
            "categoryId",
            [db.sequelize.fn("COUNT", db.sequelize.col("Expense.id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("Expense.amount")), "amount"],
            [db.sequelize.fn("AVG", db.sequelize.col("Expense.amount")), "avgAmount"],
          ],
          group: ["categoryId", "category.id"],
          order: [[db.sequelize.literal("amount"), "DESC"]],
        }),

        // Expenses by payment method
        db.Expense.findAll({
          where: whereClause,
          attributes: [
            "paymentMethod",
            [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
          ],
          group: ["paymentMethod"],
        }),

        // Top expenses
        db.Expense.findAll({
          where: whereClause,
          include: [
            {
              model: db.ExpenseCategory,
              as: "category",
              attributes: ["name", "color"],
            },
          ],
          order: [["amount", "DESC"]],
          limit: 10,
          attributes: ["id", "description", "amount", "date", "paymentMethod"],
        }),

        // Daily expenses chart
        db.Expense.findAll({
          where: whereClause,
          attributes: [
            [db.sequelize.fn("DATE", db.sequelize.col("date")), "date"],
            [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
          ],
          group: [db.sequelize.fn("DATE", db.sequelize.col("date"))],
          order: [[db.sequelize.fn("DATE", db.sequelize.col("date")), "ASC"]],
        }),
      ]);

      const summary = {
        period,
        startDate,
        endDate,
        totalExpenses,
        totalAmount: totalAmount || 0,
        averageExpense: totalExpenses > 0 ? (totalAmount || 0) / totalExpenses : 0,
        expensesByCategory: expensesByCategory.map((item) => ({
          categoryId: item.categoryId,
          categoryName: item.category?.name || "Uncategorized",
          categoryColor: item.category?.color || "#6B7280",
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
          avgAmount: parseFloat(item.get("avgAmount")) || 0,
        })),
        expensesByPaymentMethod: expensesByPaymentMethod.reduce((acc, item) => {
          acc[item.paymentMethod] = {
            count: parseInt(item.get("count")),
            amount: parseFloat(item.get("amount")) || 0,
          };
          return acc;
        }, {}),
        topExpenses: topExpenses.map((expense) => ({
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          date: expense.date,
          paymentMethod: expense.paymentMethod,
          categoryName: expense.category?.name || "Uncategorized",
          categoryColor: expense.category?.color || "#6B7280",
        })),
        dailyChart: dailyExpensesChart.map((item) => ({
          date: item.get("date"),
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
      };

      res.json(successResponse("Expense report generated successfully", { report: summary }));
    } catch (error) {
      console.error("Expense report error:", error);
      res.status(500).json(errorResponse("Failed to generate expense report", error.message));
    }
  }
);

// Profit & Loss Report
router.get(
  "/profit-loss",
  [
    authenticate,
    query("period").optional().isIn(["month", "quarter", "year", "custom"]),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("branchId").optional().isUUID(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { period = "month", dateFrom, dateTo, branchId } = req.query;

      // Calculate date range
      let startDate, endDate;
      const now = new Date();

      if (period === "custom" && dateFrom && dateTo) {
        startDate = new Date(dateFrom);
        endDate = new Date(dateTo);
      } else {
        endDate = now;
        switch (period) {
          case "month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case "quarter":
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            startDate = new Date(now.getFullYear(), quarterStart, 1);
            break;
          case "year":
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
          default:
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
      }

      const whereClause = {
        businessId: req.user.businessId,
        date: {
          [db.Sequelize.Op.between]: [startDate, endDate],
        },
      };

      if (branchId) {
        whereClause.branchId = branchId;
      }

      // Calculate P&L components
      const [totalRevenue, totalPurchases, totalExpenses] = await Promise.all([
        // Total revenue from sales
        db.Sale.sum("total", { where: whereClause }),

        // Total cost of goods sold (purchases)
        db.Purchase.sum("total", { where: whereClause }),

        // Total operating expenses
        db.Expense.sum("amount", { where: whereClause }),
      ]);

      const revenue = totalRevenue || 0;
      const costOfGoodsSold = totalPurchases || 0;
      const operatingExpenses = totalExpenses || 0;

      const grossProfit = revenue - costOfGoodsSold;
      const netProfit = grossProfit - operatingExpenses;
      const grossProfitMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const netProfitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

      const summary = {
        period,
        startDate,
        endDate,
        revenue,
        costOfGoodsSold,
        grossProfit,
        grossProfitMargin,
        operatingExpenses,
        netProfit,
        netProfitMargin,
        breakdown: {
          revenuePercentage: 100,
          cogsPercentage: revenue > 0 ? (costOfGoodsSold / revenue) * 100 : 0,
          expensesPercentage: revenue > 0 ? (operatingExpenses / revenue) * 100 : 0,
          profitPercentage: netProfitMargin,
        },
      };

      res.json(successResponse("Profit & Loss report generated successfully", { report: summary }));
    } catch (error) {
      console.error("Profit & Loss report error:", error);
      res.status(500).json(errorResponse("Failed to generate P&L report", error.message));
    }
  }
);

// Inventory Valuation Report
router.get("/inventory", authenticate, async (req, res) => {
  try {
    const branchId = await resolveReportBranchId(req);

    // Inventory has no businessId — scope through Product.businessId
    const whereClause = branchId ? { branchId } : {};
    const productScope = {
      model: db.Product,
      as: "product",
      required: true,
      where: { businessId: req.user.businessId },
    };

    // Get inventory summary
    const [inventoryItems, lowStockItems, totalStockValue, categoryBreakdown] = await Promise.all([
      // All inventory items with current stock
      db.Inventory.findAll({
        where: whereClause,
        include: [
          {
            ...productScope,
            attributes: ["id", "name", "sku", "sellingPrice"],
            include: [
              {
                model: db.Category,
                as: "category",
                attributes: ["id", "name", "color"],
              },
            ],
          },
        ],
        attributes: ["quantity", "averageCostPrice", "reorderPoint", "lastStockUpdate"],
      }),

      // Low stock items
      db.Inventory.findAll({
        where: {
          ...whereClause,
          // underscored: true → DB column is reorder_point
          quantity: { [db.Sequelize.Op.lte]: db.sequelize.col("reorder_point") },
        },
        include: [
          {
            ...productScope,
            attributes: ["id", "name", "sku"],
          },
        ],
      }),

      // Total stock value
      db.Inventory.findAll({
        where: whereClause,
        include: [{ ...productScope, attributes: [] }],
        attributes: [
          [
            db.sequelize.fn(
              "SUM",
              db.sequelize.literal("`Inventory`.`quantity` * `Inventory`.`average_cost_price`")
            ),
            "totalValue",
          ],
        ],
        raw: true,
      }),

      // Stock value by category
      db.Inventory.findAll({
        where: whereClause,
        include: [
          {
            ...productScope,
            include: [
              {
                model: db.Category,
                as: "category",
                attributes: ["id", "name", "color"],
              },
            ],
          },
        ],
        attributes: [
          [
            db.sequelize.fn(
              "SUM",
              db.sequelize.literal("`Inventory`.`quantity` * `Inventory`.`average_cost_price`")
            ),
            "categoryValue",
          ],
          [
            db.sequelize.fn("SUM", db.sequelize.col("Inventory.quantity")),
            "totalQuantity",
          ],
        ],
        group: ["product.category.id"],
      }),
    ]);

    const totalValue =
      totalStockValue[0]?.totalValue ||
      totalStockValue[0]?.get?.("totalValue") ||
      0;

    const summary = {
      totalItems: inventoryItems.length,
      totalStockValue: parseFloat(totalValue),
      lowStockItems: lowStockItems.length,
      inventoryItems: inventoryItems.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        sku: item.product.sku,
        quantity: item.quantity,
        averageCostPrice: item.averageCostPrice,
        sellingPrice: item.product.sellingPrice,
        stockValue: item.quantity * item.averageCostPrice,
        potentialRevenue: item.quantity * item.product.sellingPrice,
        reorderPoint: item.reorderPoint,
        isLowStock: item.quantity <= item.reorderPoint,
        categoryName: item.product.category?.name || "Uncategorized",
        categoryColor: item.product.category?.color || "#6B7280",
      })),
      lowStockProducts: lowStockItems.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        sku: item.product.sku,
        currentStock: item.quantity,
        reorderPoint: item.reorderPoint,
      })),
      categoryBreakdown: categoryBreakdown.map((item) => ({
        categoryId: item.product?.category?.id,
        categoryName: item.product?.category?.name || "Uncategorized",
        categoryColor: item.product?.category?.color || "#6B7280",
        totalValue: parseFloat(item.get("categoryValue")) || 0,
        totalQuantity: parseFloat(item.get("totalQuantity")) || 0,
      })),
    };

    res.json(successResponse("Inventory report generated successfully", { report: summary }));
  } catch (error) {
    if (handleTenantError(res, error)) return;
    console.error("Inventory report error:", error);
    res.status(500).json(errorResponse("Failed to generate inventory report", error.message));
  }
});

module.exports = router;
