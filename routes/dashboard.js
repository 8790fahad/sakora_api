const express = require("express");
const { query } = require("express-validator");
const { validationRules, handleValidationErrors } = require("../utils/validation");
const { errorResponse, successResponse } = require("../utils/helpers");
const { authenticate } = require("../middleware/auth");
const db = require("../models");

const router = express.Router();

// Get dashboard statistics and overview
router.get("/stats", authenticate, async (req, res) => {
  try {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    const whereClauseBusiness = { businessId: req.user.businessId };
    const whereClauseBranch = { branchId: req.user.branchId };
    // Use branchId only since branches are already tied to businesses
    const whereClauseBranchWithBusiness = { branchId: req.user.branchId };

    // Get comprehensive stats
    const [
      // Today's stats
      todaySales,
      todayRevenue,
      todayExpenses,

      // Month stats
      monthSales,
      monthRevenue,
      monthExpenses,
      monthPurchases,

      // Current balances and counts
      currentCashBalance,
      totalCustomers,
      totalSuppliers,
      totalProducts,
      totalInventoryValue,
      lowStockCount,

      // Recent activities
      recentSales,
      recentExpenses,
      pendingPurchases,

      // Top performers
      topProducts,
      topCustomers,

      // Alerts and notifications
      lowStockProducts,
      overduePayments,

    ] = await Promise.all([
      // Today's sales
      db.Sale.count({
        where: {
          ...whereClauseBranchWithBusiness,
          date: { [db.Sequelize.Op.gte]: startOfToday },
        },
      }),

      // Today's revenue
      db.Sale.sum("total", {
        where: {
          ...whereClauseBranchWithBusiness,
          date: { [db.Sequelize.Op.gte]: startOfToday },
        },
      }),

      // Today's expenses
      db.Expense.sum("amount", {
        where: {
          ...whereClauseBranch,
          date: { [db.Sequelize.Op.gte]: startOfToday },
        },
      }),

      // This month's sales
      db.Sale.count({
        where: {
          ...whereClauseBranchWithBusiness,
          date: { [db.Sequelize.Op.gte]: startOfMonth },
        },
      }),

      // This month's revenue
      db.Sale.sum("total", {
        where: {
          ...whereClauseBranchWithBusiness,
          date: { [db.Sequelize.Op.gte]: startOfMonth },
        },
      }),

      // This month's expenses
      db.Expense.sum("amount", {
        where: {
          ...whereClauseBranch,
          date: { [db.Sequelize.Op.gte]: startOfMonth },
        },
      }),

      // This month's purchases
      db.Purchase.sum("total", {
        where: {
          ...whereClauseBranchWithBusiness,
          date: { [db.Sequelize.Op.gte]: startOfMonth },
        },
      }),

      // Current cash balance
      db.CashTransaction.findOne({
        where: whereClauseBranch,
        order: [["createdAt", "DESC"]],
        attributes: ["runningBalance"],
      }),

      // Total customers
      db.Customer.count({ where: whereClauseBusiness }),

      // Total suppliers
      db.Supplier.count({ where: whereClauseBusiness }),

      // Total products
      db.Product.count({ where: whereClauseBusiness }),

      // Total inventory value
      db.Inventory.findAll({
        where: { branchId: req.user.branchId },
        attributes: [
          [
            db.sequelize.fn("SUM",
              db.sequelize.literal("quantity * average_cost_price")
            ),
            "totalValue",
          ],
        ],
      }),

      // Low stock items count
      db.Inventory.count({
        where: {
          branchId: req.user.branchId,
          quantity: { [db.Sequelize.Op.lte]: db.sequelize.col("reorder_point") },
        },
      }),

      // Recent sales (last 5)
      db.Sale.findAll({
        where: whereClauseBranchWithBusiness,
        include: [
          {
            model: db.Customer,
            as: "customer",
            attributes: ["name"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: 5,
        attributes: ["id", "saleNumber", "total", "date", "paymentStatus"],
      }),

      // Recent expenses (last 5)
      db.Expense.findAll({
        where: whereClauseBranch,
        include: [
          {
            model: db.ExpenseCategory,
            as: "category",
            attributes: ["name", "color"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: 5,
        attributes: ["id", "description", "amount", "date", "paymentMethod"],
      }),

      // Pending purchases
      db.Purchase.findAll({
        where: {
          branchId: req.user.branchId,
          paymentStatus: ["pending", "overdue"],
        },
        include: [
          {
            model: db.Supplier,
            as: "supplier",
            attributes: ["name"],
          },
        ],
        order: [["date", "ASC"]],
        limit: 5,
        attributes: ["id", "purchaseNumber", "total", "date", "paymentStatus"],
      }),

      // Top products (this month)
      db.SaleItem.findAll({
        include: [
          {
            model: db.Sale,
            as: "sale",
            where: {
              ...whereClauseBranchWithBusiness,
              date: { [db.Sequelize.Op.gte]: startOfMonth },
            },
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
          [db.sequelize.fn("SUM", db.sequelize.col("quantity")), "totalSold"],
          [db.sequelize.fn("SUM", db.sequelize.col("SaleItem.total_price")), "totalRevenue"],
        ],
        group: ["productId", "product.id"],
        order: [[db.sequelize.literal("totalRevenue"), "DESC"]],
        limit: 3,
      }),

      // Top customers (this month)
      db.Sale.findAll({
        where: {
          ...whereClauseBranchWithBusiness,
          date: { [db.Sequelize.Op.gte]: startOfMonth },
          customerId: { [db.Sequelize.Op.ne]: null },
        },
        include: [
          {
            model: db.Customer,
            as: "customer",
            attributes: ["id", "name"],
          },
        ],
        attributes: [
          "customerId",
          [db.sequelize.fn("COUNT", db.sequelize.col("Sale.id")), "salesCount"],
          [db.sequelize.fn("SUM", db.sequelize.col("total")), "totalSpent"],
        ],
        group: ["customerId", "customer.id"],
        order: [[db.sequelize.literal("totalSpent"), "DESC"]],
        limit: 3,
      }),

      // Low stock products
      db.Inventory.findAll({
        where: {
          branchId: req.user.branchId,
          quantity: { [db.Sequelize.Op.lte]: db.sequelize.col("reorder_point") },
        },
        include: [
          {
            model: db.Product,
            as: "product",
            attributes: ["id", "name", "sku"],
          },
        ],
        attributes: ["quantity", "reorderPoint"],
        limit: 5,
      }),

      // Overdue payments
      db.Purchase.findAll({
        where: {
          branchId: req.user.branchId,
          paymentStatus: "overdue",
        },
        include: [
          {
            model: db.Supplier,
            as: "supplier",
            attributes: ["name"],
          },
        ],
        attributes: ["id", "purchaseNumber", "total", "date"],
        limit: 3,
      }),
    ]);

    // Calculate month-to-date profit
    const monthProfit = (monthRevenue || 0) - (monthPurchases || 0) - (monthExpenses || 0);

    // Calculate today's profit
    const todayProfit = (todayRevenue || 0) - (todayExpenses || 0);

    const stats = {
      // Today's performance
      today: {
        sales: todaySales || 0,
        revenue: todayRevenue || 0,
        expenses: todayExpenses || 0,
        profit: todayProfit,
      },

      // Month performance
      thisMonth: {
        sales: monthSales || 0,
        revenue: monthRevenue || 0,
        expenses: monthExpenses || 0,
        purchases: monthPurchases || 0,
        profit: monthProfit,
        profitMargin: monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0,
      },

      // Current totals
      totals: {
        cashBalance: currentCashBalance?.runningBalance || 0,
        customers: totalCustomers || 0,
        suppliers: totalSuppliers || 0,
        products: totalProducts || 0,
        inventoryValue: parseFloat(totalInventoryValue[0]?.get("totalValue")) || 0,
        lowStockItems: lowStockCount || 0,
      },

      // Recent activities
      recent: {
        sales: recentSales || [],
        expenses: recentExpenses || [],
        pendingPurchases: pendingPurchases || [],
      },

      // Top performers
      topPerformers: {
        products: (topProducts || []).map((item) => ({
          productId: item.productId,
          name: item.product?.name || "Unknown",
          sku: item.product?.sku,
          totalSold: parseFloat(item.get("totalSold")) || 0,
          totalRevenue: parseFloat(item.get("totalRevenue")) || 0,
        })),
        customers: (topCustomers || []).map((item) => ({
          customerId: item.customerId,
          name: item.customer?.name || "Unknown",
          salesCount: parseInt(item.get("salesCount")) || 0,
          totalSpent: parseFloat(item.get("totalSpent")) || 0,
        })),
      },

      // Alerts and notifications
      alerts: {
        lowStock: (lowStockProducts || []).map((item) => ({
          productId: item.product?.id,
          name: item.product?.name,
          sku: item.product?.sku,
          currentStock: item.quantity,
          reorderPoint: item.reorderPoint,
        })),
        overduePayments: (overduePayments || []).map((item) => ({
          purchaseId: item.id,
          reference: item.reference,
          supplier: item.supplier?.name,
          amount: item.total,
          daysOverdue: Math.floor(
            (new Date() - new Date(item.date)) / (1000 * 60 * 60 * 24)
          ),
        })),
      },
    };

    res.json(successResponse("Dashboard stats retrieved successfully", stats));
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json(errorResponse("Failed to retrieve dashboard stats", error.message));
  }
});

// Get chart data for dashboard visualizations
router.get("/charts", authenticate, async (req, res) => {
  try {
    const { period = "week" } = req.query;

    let startDate;
    const endDate = new Date();

    switch (period) {
      case "week":
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        break;
      case "quarter":
        const quarterStart = Math.floor(endDate.getMonth() / 3) * 3;
        startDate = new Date(endDate.getFullYear(), quarterStart, 1);
        break;
      default:
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    // Use branchId only since branches are already tied to businesses
    const saleWhereClause = {
      branchId: req.user.branchId,
      date: {
        [db.Sequelize.Op.between]: [startDate, endDate],
      },
    };

    const expenseWhereClause = {
      branchId: req.user.branchId,
      date: {
        [db.Sequelize.Op.between]: [startDate, endDate],
      },
    };

    // Get daily sales and expense data for charts
    const [dailySales, dailyExpenses, salesByPaymentMethod, expensesByCategory] = await Promise.all([
      // Daily sales chart
      db.Sale.findAll({
        where: saleWhereClause,
        attributes: [
          [db.sequelize.fn("DATE", db.sequelize.col("date")), "date"],
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
          [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
        ],
        group: [db.sequelize.fn("DATE", db.sequelize.col("date"))],
        order: [[db.sequelize.fn("DATE", db.sequelize.col("date")), "ASC"]],
      }),

      // Daily expenses chart
      db.Expense.findAll({
        where: expenseWhereClause,
        attributes: [
          [db.sequelize.fn("DATE", db.sequelize.col("date")), "date"],
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
          [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
        ],
        group: [db.sequelize.fn("DATE", db.sequelize.col("date"))],
        order: [[db.sequelize.fn("DATE", db.sequelize.col("date")), "ASC"]],
      }),

      // Sales by payment method (pie chart data)
      db.Sale.findAll({
        where: saleWhereClause,
        attributes: [
          "paymentMethod",
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
          [db.sequelize.fn("SUM", db.sequelize.col("total")), "amount"],
        ],
        group: ["paymentMethod"],
      }),

      // Expenses by category (pie chart data)
      db.Expense.findAll({
        where: expenseWhereClause,
        include: [
          {
            model: db.ExpenseCategory,
            as: "category",
            attributes: ["name", "color"],
          },
        ],
        attributes: [
          "categoryId",
          [db.sequelize.fn("COUNT", db.sequelize.col("Expense.id")), "count"],
          [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
        ],
        group: ["categoryId", "category.id"],
      }),
    ]);

    const chartData = {
      period,
      startDate,
      endDate,

      // Daily trends
      dailyTrends: {
        sales: dailySales.map((item) => ({
          date: item.get("date"),
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
        expenses: dailyExpenses.map((item) => ({
          date: item.get("date"),
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
      },

      // Distribution charts
      distributions: {
        paymentMethods: salesByPaymentMethod.map((item) => ({
          method: item.paymentMethod,
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
        expenseCategories: expensesByCategory.map((item) => ({
          categoryId: item.categoryId,
          name: item.category?.name || "Uncategorized",
          color: item.category?.color || "#6B7280",
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        })),
      },
    };

    res.json(successResponse("Dashboard chart data retrieved successfully", chartData));
  } catch (error) {
    console.error("Dashboard charts error:", error);
    res.status(500).json(errorResponse("Failed to retrieve chart data", error.message));
  }
});

// Get recent activities for activity feed
router.get("/recent", authenticate, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const parsedLimit = parseInt(limit, 10) || 10;

    // Use branchId only since branches are already tied to businesses
    const saleWhereClause = { branchId: req.user.branchId };
    const branchWhereClause = { branchId: req.user.branchId };

    // Get recent activities from different sources
    const [recentSales, recentPurchases, recentExpenses, recentCashTransactions] = await Promise.all([
      // Recent sales
      db.Sale.findAll({
        where: saleWhereClause,
        include: [
          {
            model: db.Customer,
            as: "customer",
            attributes: ["name"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: Math.floor(parsedLimit / 4),
        attributes: ["id", "saleNumber", "total", "createdAt", "paymentMethod"],
      }),

      // Recent purchases
      db.Purchase.findAll({
        where: saleWhereClause,
        include: [
          {
            model: db.Supplier,
            as: "supplier",
            attributes: ["name"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: Math.floor(parsedLimit / 4),
        attributes: ["id", "purchaseNumber", "total", "createdAt", "paymentMethod"],
      }),

      // Recent expenses
      db.Expense.findAll({
        where: branchWhereClause,
        include: [
          {
            model: db.ExpenseCategory,
            as: "category",
            attributes: ["name"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: Math.floor(parsedLimit / 4),
        attributes: ["id", "description", "amount", "createdAt"],
      }),

      // Recent cash transactions
      db.CashTransaction.findAll({
        where: {
          ...branchWhereClause,
          referenceType: "adjustment",
        },
        order: [["createdAt", "DESC"]],
        limit: Math.floor(parsedLimit / 4),
        attributes: ["id", "type", "amount", "description", "createdAt"],
      }),
    ]);

    // Combine and format activities
    const activities = [];

    // Add sales activities
    recentSales.forEach((sale) => {
      activities.push({
        id: `sale-${sale.id}`,
        type: "sale",
        title: `Sale ${sale.saleNumber}`,
        description: sale.customer?.name ? `Customer: ${sale.customer.name}` : "Walk-in customer",
        amount: sale.total,
        timestamp: sale.createdAt,
        icon: "shopping-cart",
        color: "green",
      });
    });

    // Add purchase activities
    recentPurchases.forEach((purchase) => {
      activities.push({
        id: `purchase-${purchase.id}`,
        type: "purchase",
        title: `Purchase ${purchase.purchaseNumber}`,
        description: purchase.supplier?.name ? `Supplier: ${purchase.supplier.name}` : "Unknown supplier",
        amount: -purchase.total,
        timestamp: purchase.createdAt,
        icon: "shopping-bag",
        color: "blue",
      });
    });

    // Add expense activities
    recentExpenses.forEach((expense) => {
      activities.push({
        id: `expense-${expense.id}`,
        type: "expense",
        title: expense.description,
        description: expense.category?.name ? `Category: ${expense.category.name}` : "Uncategorized",
        amount: -expense.amount,
        timestamp: expense.createdAt,
        icon: "receipt",
        color: "red",
      });
    });

    // Add cash transaction activities
    recentCashTransactions.forEach((transaction) => {
      activities.push({
        id: `cash-${transaction.id}`,
        type: "cash",
        title: transaction.description,
        description: `Manual ${transaction.type === "in" ? "cash in" : "cash out"}`,
        amount: transaction.type === "in" ? transaction.amount : -transaction.amount,
        timestamp: transaction.createdAt,
        icon: "dollar-sign",
        color: transaction.type === "in" ? "green" : "orange",
      });
    });

    // Sort by timestamp and limit
    const sortedActivities = activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parsedLimit);

    res.json(successResponse("Recent activities retrieved successfully", { activities: sortedActivities }));
  } catch (error) {
    console.error("Recent activities error:", error);
    res.status(500).json(errorResponse("Failed to retrieve recent activities", error.message));
  }
});

// Get alerts and notifications
router.get("/alerts", authenticate, async (req, res) => {
  try {
    const branchWhereClause = {
      branchId: req.user.branchId,
    };

    const [lowStockProducts, overduePayments, lowCashBalance] = await Promise.all([
      // Low stock alerts
      db.Inventory.findAll({
        where: {
          ...branchWhereClause,
          quantity: { [db.Sequelize.Op.lte]: db.sequelize.col("reorder_point") },
        },
        include: [
          {
            model: db.Product,
            as: "product",
            attributes: ["name", "sku"],
          },
        ],
        attributes: ["quantity", "reorderPoint"],
        limit: 10,
      }),

      // Overdue payment alerts
      db.Purchase.findAll({
        where: {
          branchId: req.user.branchId,
          paymentStatus: "overdue",
        },
        include: [
          {
            model: db.Supplier,
            as: "supplier",
            attributes: ["name"],
          },
        ],
        attributes: ["purchaseNumber", "total", "date"],
        limit: 5,
      }),

      // Check cash balance (alert if negative)
      db.CashTransaction.findOne({
        where: branchWhereClause,
        order: [["createdAt", "DESC"]],
        attributes: ["runningBalance"],
      }),
    ]);

    const alerts = [];

    // Low stock alerts
    if (lowStockProducts.length > 0) {
      alerts.push({
        id: "low-stock",
        type: "warning",
        title: "Low Stock Alert",
        message: `${lowStockProducts.length} products are running low`,
        priority: "medium",
        count: lowStockProducts.length,
        details: lowStockProducts.map((item) => ({
          name: item.product?.name,
          sku: item.product?.sku,
          currentStock: item.quantity,
          reorderPoint: item.reorderPoint,
        })),
      });
    }

    // Overdue payment alerts
    if (overduePayments.length > 0) {
      const totalOverdue = overduePayments.reduce((sum, payment) => sum + parseFloat(payment.total || 0), 0);
      alerts.push({
        id: "overdue-payments",
        type: "error",
        title: "Overdue Payments",
        message: `${overduePayments.length} payments are overdue`,
        priority: "high",
        count: overduePayments.length,
        totalAmount: totalOverdue,
        details: overduePayments.map((payment) => ({
          reference: payment.purchaseNumber,
          supplier: payment.supplier?.name,
          amount: payment.total,
          daysOverdue: Math.floor(
            (new Date() - new Date(payment.date)) / (1000 * 60 * 60 * 24)
          ),
        })),
      });
    }

    // Low cash balance alert
    const currentBalance = lowCashBalance?.runningBalance || 0;
    if (currentBalance < 0) {
      alerts.push({
        id: "negative-cash",
        type: "error",
        title: "Negative Cash Balance",
        message: "Your cash balance is negative",
        priority: "high",
        amount: currentBalance,
      });
    } else if (currentBalance < 10000) { // Alert if balance is below 10k (configurable)
      alerts.push({
        id: "low-cash",
        type: "warning",
        title: "Low Cash Balance",
        message: "Your cash balance is getting low",
        priority: "medium",
        amount: currentBalance,
      });
    }

    res.json(successResponse("Alerts retrieved successfully", { alerts }));
  } catch (error) {
    console.error("Alerts error:", error);
    res.status(500).json(errorResponse("Failed to retrieve alerts", error.message));
  }
});

module.exports = router;
