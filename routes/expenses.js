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
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../models");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../uploads/receipts");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "receipt-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only images and PDF files are allowed"));
    }
  },
});

// Get all expenses with pagination and filters
router.get(
  "/",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().trim(),
    query("category").optional().isUUID(),
    query("paymentMethod").optional().isIn([
      "cash",
      "bank_transfer",
      "cheque",
      "card",
    ]),
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    query("sortBy").optional().isIn(["date", "amount", "description"]),
    query("sortOrder").optional().isIn(["asc", "desc"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        category,
        paymentMethod,
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
          { description: { [db.Sequelize.Op.like]: `%${search}%` } },
          { notes: { [db.Sequelize.Op.like]: `%${search}%` } },
          { reference: { [db.Sequelize.Op.like]: `%${search}%` } },
        ];
      }

      if (category) {
        where.expenseCategoryId = category;
      }

      if (paymentMethod) {
        where.paymentMethod = paymentMethod;
      }

      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) where.date[db.Sequelize.Op.gte] = new Date(dateFrom);
        if (dateTo) where.date[db.Sequelize.Op.lte] = new Date(dateTo);
      }

      const expenses = await db.Expense.findAndCountAll({
        where,
        include: [
          {
            model: db.ExpenseCategory,
            as: "category",
            attributes: ["id", "name", "color", "icon"],
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
        ],
        order: [[sortBy, sortOrder.toUpperCase()]],
        limit: pageLimit,
        offset,
        distinct: true,
      });

      const response = getPagingData(
        expenses.rows,
        page,
        pageLimit,
        expenses.count
      );

      res.json(successResponse("Expenses retrieved successfully", response));
    } catch (error) {
      console.error("Expenses list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve expenses", error.message));
    }
  }
);

// Get single expense details
router.get(
  "/:id",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const { id } = req.params;

      const expense = await db.Expense.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
        include: [
          {
            model: db.ExpenseCategory,
            as: "category",
            attributes: ["id", "name", "color", "icon", "description"],
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
        ],
      });

      if (!expense) {
        return res.status(404).json(errorResponse("Expense not found"));
      }

      res.json(successResponse("Expense retrieved successfully", { expense }));
    } catch (error) {
      console.error("Expense details error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve expense", error.message));
    }
  }
);

// Create new expense
router.post(
  "/",
  [
    authenticate,
    authorize(["owner", "manager", "staff"]),
    upload.single("receipt"),
    body("description").trim().isLength({ min: 2, max: 200 }),
    body("amount").isFloat({ min: 0.01 }),
    body("date").isISO8601(),
    body("expenseCategoryId").isUUID(),
    body("paymentMethod").isIn(["cash", "bank_transfer", "cheque", "card"]),
    body("reference").optional().trim().isLength({ max: 50 }),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const {
        description,
        amount,
        date,
        expenseCategoryId,
        paymentMethod,
        reference,
        notes,
      } = req.body;

      // Verify expense category belongs to business
      const category = await db.ExpenseCategory.findOne({
        where: {
          id: expenseCategoryId,
          businessId: req.user.businessId,
        },
      });

      if (!category) {
        await transaction.rollback();
        if (req.file) {
          fs.unlinkSync(req.file.path); // Clean up uploaded file
        }
        return res.status(400).json(errorResponse("Invalid expense category"));
      }

      // Create expense
      const expense = await db.Expense.create(
        {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          expenseCategoryId,
          description,
          amount: parseFloat(amount),
          date: new Date(date),
          paymentMethod,
          reference,
          notes,
          receiptPath: req.file ? req.file.filename : null,
          createdBy: req.user.id,
        },
        { transaction }
      );

      // Create cash transaction
      const runningBalance = await updateCashBalance(
        req.user.branchId,
        parseFloat(amount),
        "out",
        db
      );

      await db.CashTransaction.create(
        {
          businessId: req.user.businessId,
          branchId: req.user.branchId,
          type: "out",
          amount: parseFloat(amount),
          description: `Expense - ${description}`,
          referenceType: "expense",
          referenceId: expense.id,
          referenceNumber: reference,
          paymentMethod,
          runningBalance,
          notes,
          createdBy: req.user.id,
        },
        { transaction }
      );

      await transaction.commit();

      // Return expense with full details
      const expenseWithDetails = await db.Expense.findByPk(expense.id, {
        include: [
          { model: db.ExpenseCategory, as: "category" },
          { model: db.Branch, as: "branch" },
          { model: db.User, as: "creator" },
        ],
      });

      res.status(201).json(
        successResponse("Expense recorded successfully", {
          expense: expenseWithDetails,
        })
      );
    } catch (error) {
      await transaction.rollback();
      if (req.file) {
        fs.unlinkSync(req.file.path); // Clean up uploaded file on error
      }
      console.error("Expense creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to record expense", error.message));
    }
  }
);

// Update expense
router.put(
  "/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    upload.single("receipt"),
    body("description").optional().trim().isLength({ min: 2, max: 200 }),
    body("amount").optional().isFloat({ min: 0.01 }),
    body("date").optional().isISO8601(),
    body("expenseCategoryId").optional().isUUID(),
    body("paymentMethod")
      .optional()
      .isIn(["cash", "bank_transfer", "cheque", "card"]),
    body("reference").optional().trim().isLength({ max: 50 }),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { id } = req.params;
      const updates = req.body;

      const expense = await db.Expense.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!expense) {
        await transaction.rollback();
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json(errorResponse("Expense not found"));
      }

      // If category is being updated, verify it belongs to business
      if (updates.expenseCategoryId) {
        const category = await db.ExpenseCategory.findOne({
          where: {
            id: updates.expenseCategoryId,
            businessId: req.user.businessId,
          },
        });

        if (!category) {
          await transaction.rollback();
          if (req.file) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json(errorResponse("Invalid expense category"));
        }
      }

      // Handle receipt upload
      if (req.file) {
        // Delete old receipt if exists
        if (expense.receiptPath) {
          const oldReceiptPath = path.join(
            __dirname,
            "../uploads/receipts",
            expense.receiptPath
          );
          if (fs.existsSync(oldReceiptPath)) {
            fs.unlinkSync(oldReceiptPath);
          }
        }
        updates.receiptPath = req.file.filename;
      }

      await expense.update(updates, { transaction });

      // Update cash transaction if amount changed
      if (updates.amount && parseFloat(updates.amount) !== expense.amount) {
        const cashTransaction = await db.CashTransaction.findOne({
          where: {
            referenceType: "expense",
            referenceId: expense.id,
          },
        });

        if (cashTransaction) {
          const amountDifference =
            parseFloat(updates.amount) - expense.amount;
          const newRunningBalance = await updateCashBalance(
            req.user.branchId,
            amountDifference,
            "out",
            db
          );

          await cashTransaction.update(
            {
              amount: parseFloat(updates.amount),
              runningBalance: newRunningBalance,
            },
            { transaction }
          );
        }
      }

      await transaction.commit();

      // Return updated expense
      const updatedExpense = await db.Expense.findByPk(id, {
        include: [
          { model: db.ExpenseCategory, as: "category" },
          { model: db.Branch, as: "branch" },
          { model: db.User, as: "creator" },
        ],
      });

      res.json(
        successResponse("Expense updated successfully", {
          expense: updatedExpense,
        })
      );
    } catch (error) {
      await transaction.rollback();
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      console.error("Expense update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update expense", error.message));
    }
  }
);

// Delete expense
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

      const expense = await db.Expense.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!expense) {
        await transaction.rollback();
        return res.status(404).json(errorResponse("Expense not found"));
      }

      // Delete receipt file if exists
      if (expense.receiptPath) {
        const receiptPath = path.join(
          __dirname,
          "../uploads/receipts",
          expense.receiptPath
        );
        if (fs.existsSync(receiptPath)) {
          fs.unlinkSync(receiptPath);
        }
      }

      // Delete related cash transaction
      await db.CashTransaction.destroy({
        where: {
          referenceType: "expense",
          referenceId: expense.id,
        },
        transaction,
      });

      // Reverse cash balance
      await updateCashBalance(req.user.branchId, expense.amount, "in", db);

      // Delete expense
      await expense.destroy({ transaction });

      await transaction.commit();

      res.json(successResponse("Expense deleted successfully"));
    } catch (error) {
      await transaction.rollback();
      console.error("Expense deletion error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to delete expense", error.message));
    }
  }
);

// Get expense categories
router.get("/categories/list", authenticate, async (req, res) => {
  try {
    const categories = await db.ExpenseCategory.findAll({
      where: { businessId: req.user.businessId },
      order: [["name", "ASC"]],
      include: [
        {
          model: db.Expense,
          as: "expenses",
          attributes: ["id"],
          required: false,
        },
      ],
    });

    // Add expense count to each category
    const categoriesWithCount = categories.map((category) => ({
      ...category.toJSON(),
      expenseCount: category.expenses?.length || 0,
    }));

    res.json(
      successResponse("Expense categories retrieved successfully", {
        categories: categoriesWithCount,
      })
    );
  } catch (error) {
    console.error("Expense categories list error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve expense categories", error.message));
  }
});

// Create expense category
router.post(
  "/categories",
  [
    authenticate,
    authorize(["owner", "manager"]),
    body("name").trim().isLength({ min: 2, max: 50 }),
    body("description").optional().trim(),
    body("color").optional().isHexColor(),
    body("icon").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { name, description, color = "#6B7280", icon } = req.body;

      // Check if category name already exists
      const existingCategory = await db.ExpenseCategory.findOne({
        where: {
          name,
          businessId: req.user.businessId,
        },
      });

      if (existingCategory) {
        return res
          .status(400)
          .json(errorResponse("Category with this name already exists"));
      }

      const category = await db.ExpenseCategory.create({
        businessId: req.user.businessId,
        name,
        description,
        color,
        icon,
      });

      res.status(201).json(
        successResponse("Expense category created successfully", { category })
      );
    } catch (error) {
      console.error("Expense category creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create expense category", error.message));
    }
  }
);

// Update expense category
router.put(
  "/categories/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    body("name").optional().trim().isLength({ min: 2, max: 50 }),
    body("color").optional().isHexColor(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const category = await db.ExpenseCategory.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!category) {
        return res.status(404).json(errorResponse("Category not found"));
      }

      // Check name uniqueness if being updated
      if (updates.name && updates.name !== category.name) {
        const existingName = await db.ExpenseCategory.findOne({
          where: {
            name: updates.name,
            businessId: req.user.businessId,
            id: { [db.Sequelize.Op.ne]: id },
          },
        });

        if (existingName) {
          return res
            .status(400)
            .json(errorResponse("Category with this name already exists"));
        }
      }

      await category.update(updates);

      res.json(
        successResponse("Expense category updated successfully", { category })
      );
    } catch (error) {
      console.error("Expense category update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update expense category", error.message));
    }
  }
);

// Delete expense category
router.delete(
  "/categories/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;

      const category = await db.ExpenseCategory.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!category) {
        return res.status(404).json(errorResponse("Category not found"));
      }

      // Check if category has expenses
      const expenseCount = await db.Expense.count({
        where: { expenseCategoryId: id },
      });

      if (expenseCount > 0) {
        return res
          .status(400)
          .json(
            errorResponse(
              `Cannot delete category with ${expenseCount} expenses`
            )
          );
      }

      await category.destroy();

      res.json(successResponse("Expense category deleted successfully"));
    } catch (error) {
      console.error("Expense category deletion error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to delete expense category", error.message));
    }
  }
);

// Get expense statistics
router.get("/summary/stats", authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.date = {};
      if (dateFrom) dateFilter.date[db.Sequelize.Op.gte] = new Date(dateFrom);
      if (dateTo) dateFilter.date[db.Sequelize.Op.lte] = new Date(dateTo);
    }

    const [totalExpenses, totalAmount, expensesByCategory, expensesByMethod] =
      await Promise.all([
        // Total expense count
        db.Expense.count({
          where: {
            businessId: req.user.businessId,
            ...dateFilter,
          },
        }),

        // Total expense amount
        db.Expense.sum("amount", {
          where: {
            businessId: req.user.businessId,
            ...dateFilter,
          },
        }),

        // Expenses by category
        db.Expense.findAll({
          where: {
            businessId: req.user.businessId,
            ...dateFilter,
          },
          attributes: [
            "expenseCategoryId",
            [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
          ],
          include: [
            {
              model: db.ExpenseCategory,
              as: "category",
              attributes: ["name", "color"],
            },
          ],
          group: ["expenseCategoryId", "category.id"],
        }),

        // Expenses by payment method
        db.Expense.findAll({
          where: {
            businessId: req.user.businessId,
            ...dateFilter,
          },
          attributes: [
            "paymentMethod",
            [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
            [db.sequelize.fn("SUM", db.sequelize.col("amount")), "amount"],
          ],
          group: ["paymentMethod"],
        }),
      ]);

    const summary = {
      totalExpenses,
      totalAmount: totalAmount || 0,
      averageExpense: totalExpenses > 0 ? (totalAmount || 0) / totalExpenses : 0,
      byCategory: expensesByCategory.map((item) => ({
        categoryId: item.expenseCategoryId,
        categoryName: item.category?.name || "Unknown",
        categoryColor: item.category?.color || "#6B7280",
        count: parseInt(item.get("count")),
        amount: parseFloat(item.get("amount")) || 0,
      })),
      byPaymentMethod: expensesByMethod.reduce((acc, item) => {
        acc[item.paymentMethod] = {
          count: parseInt(item.get("count")),
          amount: parseFloat(item.get("amount")) || 0,
        };
        return acc;
      }, {}),
    };

    res.json(
      successResponse("Expense summary retrieved successfully", { summary })
    );
  } catch (error) {
    console.error("Expense summary error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve expense summary", error.message));
  }
});

// Download receipt
router.get("/receipt/:filename", authenticate, (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, "../uploads/receipts", filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json(errorResponse("Receipt not found"));
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error("Receipt download error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to download receipt", error.message));
  }
});

module.exports = router;

