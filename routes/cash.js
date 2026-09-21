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
  updateCashBalance,
} = require("../utils/helpers");
const { authenticate, authorize } = require("../middleware/auth");
const db = require("../models");

const router = express.Router();

// Get cash transactions with pagination and filters
router.get(
  "/transactions",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("type").optional().isIn(["in", "out"]),
    query("paymentMethod").optional().isIn([
      "cash",
      "bank_transfer",
      "cheque",
      "card",
    ]),
    query("referenceType").optional().isIn([
      "sale",
      "purchase",
      "expense",
      "manual",
      "opening_balance",
    ]),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("sortBy").optional().isIn(["createdAt", "amount", "description"]),
    query("sortOrder").optional().isIn(["asc", "desc"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        type,
        paymentMethod,
        referenceType,
        dateFrom,
        dateTo,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const { offset, limit: pageLimit } = getPagination(page, limit);

      // Build where clause
      const where = {
        businessId: req.user.businessId,
        branchId: req.user.branchId,
      };

      if (type) where.type = type;
      if (paymentMethod) where.paymentMethod = paymentMethod;
      if (referenceType) where.referenceType = referenceType;

      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom)
          where.createdAt[db.Sequelize.Op.gte] = new Date(dateFrom);
        if (dateTo) where.createdAt[db.Sequelize.Op.lte] = new Date(dateTo);
      }

      const transactions = await db.CashTransaction.findAndCountAll({
        where,
        include: [
          {
            model: db.User,
            as: "creator",
            attributes: ["id", "firstName", "lastName"],
          },
        ],
        order: [[sortBy, sortOrder.toUpperCase()]],
        limit: pageLimit,
        offset,
      });

      const response = getPagingData(
        transactions.rows,
        page,
        pageLimit,
        transactions.count
      );

      res.json(
        successResponse("Cash transactions retrieved successfully", response)
      );
    } catch (error) {
      console.error("Cash transactions error:", error);
      res
        .status(500)
        .json(
          errorResponse("Failed to retrieve cash transactions", error.message)
        );
    }
  }
);

// Get current cash balance
router.get("/balance", authenticate, async (req, res) => {
  try {
    // Get the most recent cash transaction to get current balance
    const lastTransaction = await db.CashTransaction.findOne({
      where: {
        businessId: req.user.businessId,
        branchId: req.user.branchId,
      },
      order: [["createdAt", "DESC"]],
      attributes: ["runningBalance"],
    });

    const currentBalance = lastTransaction?.runningBalance || 0;

    res.json(
      successResponse("Current cash balance retrieved", {
        balance: currentBalance,
        branchId: req.user.branchId,
      })
    );
  } catch (error) {
    console.error("Cash balance error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve cash balance", error.message));
  }
});

// Record manual cash transaction
router.post(
  "/manual",
  [
    authenticate,
    authorize(["owner", "manager"]),
    body("type").isIn(["in", "out"]),
    body("amount").isFloat({ min: 0.01 }),
    body("description").trim().isLength({ min: 2, max: 200 }),
    body("paymentMethod").isIn(["cash", "bank_transfer", "cheque", "card"]),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { type, amount, description, paymentMethod, notes } = req.body;

      // Update running balance
      const runningBalance = await updateCashBalance(
        req.user.branchId,
        parseFloat(amount),
        type,
        db
      );

      // Create cash transaction record
      const cashTransaction = await db.CashTransaction.create(
        {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          type,
          amount: parseFloat(amount),
          description,
          referenceType: "manual",
          paymentMethod,
          runningBalance,
          notes,
          createdBy: req.user.id,
        },
        { transaction }
      );

      await transaction.commit();

      // Return transaction with creator details
      const transactionWithCreator = await db.CashTransaction.findByPk(
        cashTransaction.id,
        {
          include: [
            {
              model: db.User,
              as: "creator",
              attributes: ["id", "firstName", "lastName"],
            },
          ],
        }
      );

      res.status(201).json(
        successResponse("Cash transaction recorded successfully", {
          transaction: transactionWithCreator,
          newBalance: runningBalance,
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Manual cash transaction error:", error);
      res
        .status(500)
        .json(
          errorResponse("Failed to record cash transaction", error.message)
        );
    }
  }
);

// Get cash summary/statistics
router.get("/summary", authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom)
        dateFilter.createdAt[db.Sequelize.Op.gte] = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt[db.Sequelize.Op.lte] = new Date(dateTo);
    }

    const whereClause = {
      businessId: req.user.businessId,
      branchId: req.user.branchId,
      ...dateFilter,
    };

    const [
      currentBalance,
      totalCashIn,
      totalCashOut,
      transactionCount,
      cashInByType,
      cashOutByType,
      dailyFlow,
    ] = await Promise.all([
      // Current balance
      db.CashTransaction.findOne({
        where: {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
        },
        order: [["createdAt", "DESC"]],
        attributes: ["runningBalance"],
      }),

      // Total cash in
      db.CashTransaction.sum("amount", {
        where: { ...whereClause, type: "in" },
      }),

      // Total cash out
      db.CashTransaction.sum("amount", {
        where: { ...whereClause, type: "out" },
      }),

      // Total transactions
      db.CashTransaction.count({ where: whereClause }),

      // Cash in by reference type
      db.CashTransaction.findAll({
        where: { ...whereClause, type: "in" },
        attributes: [
          "referenceType",
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
          [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
        ],
        group: ["referenceType"],
      }),

      // Cash out by reference type
      db.CashTransaction.findAll({
        where: { ...whereClause, type: "out" },
        attributes: [
          "referenceType",
          [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
          [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
        ],
        group: ["referenceType"],
      }),

      // Daily cash flow (last 7 days)
      db.CashTransaction.findAll({
        where: {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          createdAt: {
            [db.Sequelize.Op.gte]: new Date(
              Date.now() - 7 * 24 * 60 * 60 * 1000
            ),
          },
        },
        attributes: [
          [
            db.sequelize.fn("DATE", db.sequelize.col("createdAt")),
            "date",
          ],
          "type",
          [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
        ],
        group: ["date", "type"],
        order: [["date", "DESC"]],
      }),
    ]);

    const summary = {
      currentBalance: currentBalance?.runningBalance || 0,
      totalCashIn: totalCashIn || 0,
      totalCashOut: totalCashOut || 0,
      netFlow: (totalCashIn || 0) - (totalCashOut || 0),
      transactionCount,
      cashInByType: cashInByType.reduce((acc, item) => {
        acc[item.referenceType] = {
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        };
        return acc;
      }, {}),
      cashOutByType: cashOutByType.reduce((acc, item) => {
        acc[item.referenceType] = {
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        };
        return acc;
      }, {}),
      dailyFlow: dailyFlow.map((item) => ({
        date: item.get("date"),
        type: item.type,
        amount: parseFloat(item.get("amount")) || 0,
      })),
    };

    res.json(
      successResponse("Cash summary retrieved successfully", { summary })
    );
  } catch (error) {
    console.error("Cash summary error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve cash summary", error.message));
  }
});

// Set opening balance (for new businesses)
router.post(
  "/opening-balance",
  [
    authenticate,
    authorize(["owner"]),
    body("amount").isFloat({ min: 0 }),
    body("description").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { amount, description = "Opening balance" } = req.body;

      // Check if opening balance already exists
      const existingOpening = await db.CashTransaction.findOne({
        where: {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          referenceType: "opening_balance",
        },
      });

      if (existingOpening) {
        await transaction.rollback();
        return res
          .status(400)
          .json(
            errorResponse(
              "Opening balance already set. Use manual transaction to adjust."
            )
          );
      }

      // Create opening balance transaction
      const cashTransaction = await db.CashTransaction.create(
        {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          type: "in",
          amount: parseFloat(amount),
          description,
          referenceType: "opening_balance",
          paymentMethod: "cash",
          runningBalance: parseFloat(amount),
          createdBy: req.user.id,
        },
        { transaction }
      );

      await transaction.commit();

      res.status(201).json(
        successResponse("Opening balance set successfully", {
          transaction: cashTransaction,
          balance: parseFloat(amount),
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Opening balance error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to set opening balance", error.message));
    }
  }
);

// Get cash flow report
router.get("/flow", authenticate, async (req, res) => {
  try {
    const { period = "week" } = req.query;

    let startDate;
    const endDate = new Date();

    switch (period) {
      case "day":
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case "week":
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "quarter":
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    const transactions = await db.CashTransaction.findAll({
      where: {
        businessId: req.user.businessId,
        branchId: req.user.branchId,
        createdAt: {
          [db.Sequelize.Op.between]: [startDate, endDate],
        },
      },
      attributes: [
        [db.sequelize.fn("DATE", db.sequelize.col("createdAt")), "date"],
        "type",
        "referenceType",
        [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
      ],
      group: ["date", "type", "referenceType"],
      order: [["date", "ASC"]],
    });

    const flowData = transactions.map((item) => ({
      date: item.get("date"),
      type: item.type,
      referenceType: item.referenceType,
      amount: parseFloat(item.get("amount")) || 0,
      count: parseInt(item.get("count")),
    }));

    res.json(
      successResponse("Cash flow report retrieved successfully", {
        period,
        startDate,
        endDate,
        flowData,
      })
    );
  } catch (error) {
    console.error("Cash flow report error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve cash flow report", error.message));
  }
});

module.exports = router;

