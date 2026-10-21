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
} = require("../utils/helpers");
const { authenticate, authorize } = require("../middleware/auth");
const db = require("../models");
const { pickAllowed } = require("../utils/tenant");

const router = express.Router();

// Get all customers with pagination and filters
router.get(
  "/",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().trim(),
    query("sortBy").optional().isIn(["name", "phone", "email", "createdAt"]),
    query("sortOrder").optional().isIn(["asc", "desc"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        sortBy = "name",
        sortOrder = "asc",
      } = req.query;

      const { offset, limit: pageLimit } = getPagination(page, limit);

      // Build where clause
      const where = { businessId: req.user.businessId };

      if (search) {
        where[db.Sequelize.Op.or] = [
          { name: { [db.Sequelize.Op.like]: `%${search}%` } },
          { phone: { [db.Sequelize.Op.like]: `%${search}%` } },
          { email: { [db.Sequelize.Op.like]: `%${search}%` } },
        ];
      }

      const customers = await db.Customer.findAndCountAll({
        where,
        order: [[sortBy, sortOrder.toUpperCase()]],
        limit: pageLimit,
        offset,
        include: [
          {
            model: db.Sale,
            as: "sales",
            attributes: ["id", "total", "date", "paymentStatus"],
            required: false,
          },
        ],
      });

      // Calculate customer statistics
      const customersWithStats = await Promise.all(
        customers.rows.map(async (customer) => {
          const [totalSales, totalAmount, outstandingAmount] = await Promise.all([
            db.Sale.count({
              where: { customerId: customer.id },
            }),
            db.Sale.sum("total", {
              where: { customerId: customer.id },
            }),
            db.Sale.sum("total", {
              where: {
                customerId: customer.id,
                paymentStatus: ["unpaid", "partial"],
              },
            }),
          ]);

          return {
            ...customer.toJSON(),
            stats: {
              totalSales: totalSales || 0,
              totalAmount: totalAmount || 0,
              outstandingAmount: outstandingAmount || 0,
            },
          };
        })
      );

      const response = getPagingData(
        customersWithStats,
        page,
        pageLimit,
        customers.count
      );

      res.json(successResponse("Customers retrieved successfully", response));
    } catch (error) {
      console.error("Customers list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve customers", error.message));
    }
  }
);

// Get single customer details
router.get(
  "/:id",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const { id } = req.params;

      const customer = await db.Customer.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
        include: [
          {
            model: db.Sale,
            as: "sales",
            include: [
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
            order: [["date", "DESC"]],
            limit: 10,
          },
        ],
      });

      if (!customer) {
        return res.status(404).json(errorResponse("Customer not found"));
      }

      // Get customer statistics
      const [totalSales, totalAmount, outstandingAmount, lastSale] =
        await Promise.all([
          db.Sale.count({ where: { customerId: id } }),
          db.Sale.sum("total", { where: { customerId: id } }),
          db.Sale.sum("total", {
            where: {
              customerId: id,
              paymentStatus: ["unpaid", "partial"],
            },
          }),
          db.Sale.findOne({
            where: { customerId: id },
            order: [["date", "DESC"]],
            attributes: ["date", "total"],
          }),
        ]);

      const customerWithStats = {
        ...customer.toJSON(),
        stats: {
          totalSales: totalSales || 0,
          totalAmount: totalAmount || 0,
          outstandingAmount: outstandingAmount || 0,
          lastSaleDate: lastSale?.date,
          lastSaleAmount: lastSale?.total,
        },
      };

      res.json(
        successResponse("Customer retrieved successfully", {
          customer: customerWithStats,
        })
      );
    } catch (error) {
      console.error("Customer details error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve customer", error.message));
    }
  }
);

// Create new customer
router.post(
  "/",
  [
    authenticate,
    authorize(["owner", "manager", "staff"]),
    body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Name must be between 2 and 100 characters"),
    body("phone").optional().trim().isMobilePhone("any").withMessage("Please provide a valid phone number"),
    body("email").optional().trim().isEmail().withMessage("Please provide a valid email address"),
    body("address").optional().trim(),
    body("notes").optional().trim(),
    body("tin").optional().trim().isLength({ max: 50 }),
    body("customerType")
      .optional()
      .isIn(["individual", "company", "government"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { name, phone, email, address, notes, tin, customerType } = req.body;

      // Check for duplicate phone or email
      if (phone || email) {
        const duplicateConditions = [];
        if (phone) {
          duplicateConditions.push({ phone });
        }
        if (email) {
          duplicateConditions.push({ email });
        }

        const existingCustomer = await db.Customer.findOne({
          where: {
            businessId: req.user.businessId,
            [db.Sequelize.Op.or]: duplicateConditions,
          },
        });

        if (existingCustomer) {
          const field = existingCustomer.phone === phone ? "phone" : "email";
          return res
            .status(400)
            .json(errorResponse(`Customer with this ${field} already exists`));
        }
      }

      const customer = await db.Customer.create({
        businessId: req.user.businessId,
        name,
        phone,
        email,
        address,
        notes,
        tin: tin || null,
        customerType: customerType || "individual",
      });

      res.status(201).json(
        successResponse("Customer created successfully", { customer })
      );
    } catch (error) {
      console.error("Customer creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create customer", error.message));
    }
  }
);

// Update customer
router.put(
  "/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    body("name").optional().trim().isLength({ min: 2, max: 100 }),
    body("phone").optional().trim().isMobilePhone(),
    body("email").optional().trim().isEmail(),
    body("address").optional().trim(),
    body("notes").optional().trim(),
    body("tin").optional().trim().isLength({ max: 50 }),
    body("customerType")
      .optional()
      .isIn(["individual", "company", "government"]),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = pickAllowed(req.body, [
        "name",
        "phone",
        "email",
        "address",
        "notes",
        "tin",
        "customerType",
        "status",
      ]);

      const customer = await db.Customer.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!customer) {
        return res.status(404).json(errorResponse("Customer not found"));
      }

      // Check for duplicate phone or email if being updated
      if (updates.phone || updates.email) {
        const duplicateConditions = [];
        if (updates.phone && updates.phone !== customer.phone) {
          duplicateConditions.push({ phone: updates.phone });
        }
        if (updates.email && updates.email !== customer.email) {
          duplicateConditions.push({ email: updates.email });
        }

        if (duplicateConditions.length > 0) {
          const existingCustomer = await db.Customer.findOne({
            where: {
              businessId: req.user.businessId,
              id: { [db.Sequelize.Op.ne]: id },
              [db.Sequelize.Op.or]: duplicateConditions,
            },
          });

          if (existingCustomer) {
            const field = existingCustomer.phone === updates.phone ? "phone" : "email";
            return res
              .status(400)
              .json(errorResponse(`Customer with this ${field} already exists`));
          }
        }
      }

      await customer.update(updates);

      res.json(
        successResponse("Customer updated successfully", { customer })
      );
    } catch (error) {
      console.error("Customer update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update customer", error.message));
    }
  }
);

// Delete customer
router.delete(
  "/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;

      const customer = await db.Customer.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!customer) {
        return res.status(404).json(errorResponse("Customer not found"));
      }

      // Check if customer has sales
      const salesCount = await db.Sale.count({
        where: { customerId: id },
      });

      if (salesCount > 0) {
        return res
          .status(400)
          .json(
            errorResponse(
              `Cannot delete customer with ${salesCount} sales records`
            )
          );
      }

      await customer.destroy();

      res.json(successResponse("Customer deleted successfully"));
    } catch (error) {
      console.error("Customer deletion error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to delete customer", error.message));
    }
  }
);

// Get customer transactions
router.get(
  "/:id/transactions",
  [
    authenticate,
    ...validationRules.uuidParam("id"),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const { offset, limit: pageLimit } = getPagination(page, limit);

      // Verify customer belongs to business
      const customer = await db.Customer.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!customer) {
        return res.status(404).json(errorResponse("Customer not found"));
      }

      const sales = await db.Sale.findAndCountAll({
        where: { customerId: id },
        include: [
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
            model: db.SaleItem,
            as: "items",
            include: [
              {
                model: db.Product,
                as: "product",
                attributes: ["id", "name", "sku"],
              },
            ],
          },
        ],
        order: [["date", "DESC"]],
        limit: pageLimit,
        offset,
        distinct: true,
      });

      const response = getPagingData(
        sales.rows,
        page,
        pageLimit,
        sales.count
      );

      res.json(
        successResponse("Customer transactions retrieved successfully", response)
      );
    } catch (error) {
      console.error("Customer transactions error:", error);
      res
        .status(500)
        .json(
          errorResponse("Failed to retrieve customer transactions", error.message)
        );
    }
  }
);

// Get customer statistics
router.get("/summary/stats", authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt[db.Sequelize.Op.gte] = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt[db.Sequelize.Op.lte] = new Date(dateTo);
    }

    const [
      totalCustomers,
      activeCustomers,
      newCustomers,
      topCustomers,
      outstandingCustomers,
    ] = await Promise.all([
      // Total customer count
      db.Customer.count({
        where: { businessId: req.user.businessId },
      }),

      // Active customers (with sales in last 30 days)
      db.Customer.count({
        where: { businessId: req.user.businessId },
        include: [
          {
            model: db.Sale,
            as: "sales",
            where: {
              date: {
                [db.Sequelize.Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            },
            required: true,
          },
        ],
      }),

      // New customers in period
      db.Customer.count({
        where: {
          businessId: req.user.businessId,
          ...dateFilter,
        },
      }),

      // Top customers by sales
      db.Customer.findAll({
        where: { businessId: req.user.businessId },
        include: [
          {
            model: db.Sale,
            as: "sales",
            attributes: [],
          },
        ],
        attributes: [
          "id",
          "name",
          "phone",
          [db.sequelize.fn("COUNT", db.sequelize.col("sales.id")), "salesCount"],
          [db.sequelize.fn("SUM", db.sequelize.col("sales.total")), "totalAmount"],
        ],
        group: ["Customer.id"],
        order: [[db.sequelize.literal("totalAmount"), "DESC"]],
        limit: 5,
      }),

      // Customers with outstanding balances
      db.Customer.findAll({
        where: { businessId: req.user.businessId },
        include: [
          {
            model: db.Sale,
            as: "sales",
            where: {
              paymentStatus: ["unpaid", "partial"],
            },
            attributes: [],
          },
        ],
        attributes: [
          "id",
          "name",
          "phone",
          [db.sequelize.fn("SUM", db.sequelize.col("sales.total")), "outstandingAmount"],
        ],
        group: ["Customer.id"],
        having: db.sequelize.literal("outstandingAmount > 0"),
        order: [[db.sequelize.literal("outstandingAmount"), "DESC"]],
        limit: 10,
      }),
    ]);

    const summary = {
      totalCustomers,
      activeCustomers,
      newCustomers: dateFrom || dateTo ? newCustomers : null,
      topCustomers: topCustomers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        salesCount: parseInt(customer.get("salesCount")) || 0,
        totalAmount: parseFloat(customer.get("totalAmount")) || 0,
      })),
      outstandingCustomers: outstandingCustomers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        outstandingAmount: parseFloat(customer.get("outstandingAmount")) || 0,
      })),
    };

    res.json(
      successResponse("Customer summary retrieved successfully", { summary })
    );
  } catch (error) {
    console.error("Customer summary error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve customer summary", error.message));
  }
});

module.exports = router;
