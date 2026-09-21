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

const router = express.Router();

// Get all suppliers with pagination and filters
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

      const suppliers = await db.Supplier.findAndCountAll({
        where,
        order: [[sortBy, sortOrder.toUpperCase()]],
        limit: pageLimit,
        offset,
        include: [
          {
            model: db.Purchase,
            as: "purchases",
            attributes: ["id", "total", "date", "paymentStatus"],
            required: false,
          },
        ],
        distinct: true, // Important when using includes to get correct count
      });

      // Calculate supplier statistics
      const suppliersWithStats = await Promise.all(
        suppliers.rows.map(async (supplier) => {
          const [totalPurchases, totalAmount, outstandingAmount] =
            await Promise.all([
              db.Purchase.count({
                where: { supplierId: supplier.id },
              }),
              db.Purchase.sum("total", {
                where: { supplierId: supplier.id },
              }),
              db.Purchase.sum("total", {
                where: {
                  supplierId: supplier.id,
                  paymentStatus: ["pending", "partial", "overdue"],
                },
              }),
            ]);

          return {
            ...supplier.toJSON(),
            stats: {
              totalPurchases: totalPurchases || 0,
              totalAmount: totalAmount || 0,
              outstandingAmount: outstandingAmount || 0,
            },
          };
        })
      );

      const response = getPagingData(
        suppliersWithStats,
        page,
        pageLimit,
        suppliers.count
      );

      res.json(successResponse("Suppliers retrieved successfully", response));
    } catch (error) {
      console.error("Suppliers list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve suppliers", error.message));
    }
  }
);

// Get single supplier details
router.get(
  "/:id",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const { id } = req.params;

      const supplier = await db.Supplier.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
        include: [
          {
            model: db.Purchase,
            as: "purchases",
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

      if (!supplier) {
        return res.status(404).json(errorResponse("Supplier not found"));
      }

      // Get supplier statistics
      const [totalPurchases, totalAmount, outstandingAmount, lastPurchase] =
        await Promise.all([
          db.Purchase.count({ where: { supplierId: id } }),
          db.Purchase.sum("total", { where: { supplierId: id } }),
          db.Purchase.sum("total", {
            where: {
              supplierId: id,
              paymentStatus: ["pending", "partial", "overdue"],
            },
          }),
          db.Purchase.findOne({
            where: { supplierId: id },
            order: [["date", "DESC"]],
            attributes: ["date", "total"],
          }),
        ]);

      const supplierWithStats = {
        ...supplier.toJSON(),
        stats: {
          totalPurchases: totalPurchases || 0,
          totalAmount: totalAmount || 0,
          outstandingAmount: outstandingAmount || 0,
          lastPurchaseDate: lastPurchase?.date,
          lastPurchaseAmount: lastPurchase?.total,
        },
      };

      res.json(
        successResponse("Supplier retrieved successfully", {
          supplier: supplierWithStats,
        })
      );
    } catch (error) {
      console.error("Supplier details error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve supplier", error.message));
    }
  }
);

// Create new supplier
router.post(
  "/",
  [
    authenticate,
    authorize(["owner", "manager", "staff"]),
    body("name").trim().isLength({ min: 2, max: 100 }),
    body("phone").optional().trim().isMobilePhone(),
    body("email").optional().trim().isEmail(),
    body("address").optional().trim(),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { name, phone, email, address, notes } = req.body;

      // Check for duplicate phone or email
      if (phone || email) {
        const duplicateConditions = [];
        if (phone) {
          duplicateConditions.push({ phone });
        }
        if (email) {
          duplicateConditions.push({ email });
        }

        const existingSupplier = await db.Supplier.findOne({
          where: {
            businessId: req.user.businessId,
            [db.Sequelize.Op.or]: duplicateConditions,
          },
        });

        if (existingSupplier) {
          const field = existingSupplier.phone === phone ? "phone" : "email";
          return res
            .status(400)
            .json(errorResponse(`Supplier with this ${field} already exists`));
        }
      }

      const supplier = await db.Supplier.create({
        businessId: req.user.businessId,
        name,
        phone,
        email,
        address,
        notes,
      });

      res
        .status(201)
        .json(successResponse("Supplier created successfully", { supplier }));
    } catch (error) {
      console.error("Supplier creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create supplier", error.message));
    }
  }
);

// Update supplier
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
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const supplier = await db.Supplier.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!supplier) {
        return res.status(404).json(errorResponse("Supplier not found"));
      }

      // Check for duplicate phone or email if being updated
      if (updates.phone || updates.email) {
        const duplicateConditions = [];
        if (updates.phone && updates.phone !== supplier.phone) {
          duplicateConditions.push({ phone: updates.phone });
        }
        if (updates.email && updates.email !== supplier.email) {
          duplicateConditions.push({ email: updates.email });
        }

        if (duplicateConditions.length > 0) {
          const existingSupplier = await db.Supplier.findOne({
            where: {
              businessId: req.user.businessId,
              id: { [db.Sequelize.Op.ne]: id },
              [db.Sequelize.Op.or]: duplicateConditions,
            },
          });

          if (existingSupplier) {
            const field =
              existingSupplier.phone === updates.phone ? "phone" : "email";
            return res
              .status(400)
              .json(
                errorResponse(`Supplier with this ${field} already exists`)
              );
          }
        }
      }

      await supplier.update(updates);

      res.json(successResponse("Supplier updated successfully", { supplier }));
    } catch (error) {
      console.error("Supplier update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update supplier", error.message));
    }
  }
);

// Delete supplier
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

      const supplier = await db.Supplier.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!supplier) {
        return res.status(404).json(errorResponse("Supplier not found"));
      }

      // Check if supplier has purchases
      const purchaseCount = await db.Purchase.count({
        where: { supplierId: id },
      });

      if (purchaseCount > 0) {
        return res
          .status(400)
          .json(
            errorResponse(
              `Cannot delete supplier with ${purchaseCount} purchase records`
            )
          );
      }

      await supplier.destroy();

      res.json(successResponse("Supplier deleted successfully"));
    } catch (error) {
      console.error("Supplier deletion error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to delete supplier", error.message));
    }
  }
);

// Get supplier transactions
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

      // Verify supplier belongs to business
      const supplier = await db.Supplier.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!supplier) {
        return res.status(404).json(errorResponse("Supplier not found"));
      }

      const purchases = await db.Purchase.findAndCountAll({
        where: { supplierId: id },
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
            model: db.PurchaseItem,
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
        purchases.rows,
        page,
        pageLimit,
        purchases.count
      );

      res.json(
        successResponse(
          "Supplier transactions retrieved successfully",
          response
        )
      );
    } catch (error) {
      console.error("Supplier transactions error:", error);
      res
        .status(500)
        .json(
          errorResponse(
            "Failed to retrieve supplier transactions",
            error.message
          )
        );
    }
  }
);

// Get supplier statistics
router.get("/summary/stats", authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom)
        dateFilter.createdAt[db.Sequelize.Op.gte] = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt[db.Sequelize.Op.lte] = new Date(dateTo);
    }

    const [
      totalSuppliers,
      activeSuppliers,
      newSuppliers,
      topSuppliers,
      outstandingSuppliers,
    ] = await Promise.all([
      // Total supplier count
      db.Supplier.count({
        where: { businessId: req.user.businessId },
      }),

      // Active suppliers (with purchases in last 30 days)
      db.Supplier.count({
        where: { businessId: req.user.businessId },
        include: [
          {
            model: db.Purchase,
            as: "purchases",
            where: {
              date: {
                [db.Sequelize.Op.gte]: new Date(
                  Date.now() - 30 * 24 * 60 * 60 * 1000
                ),
              },
            },
            required: true,
          },
        ],
      }),

      // New suppliers in period
      db.Supplier.count({
        where: {
          businessId: req.user.businessId,
          ...dateFilter,
        },
      }),

      // Top suppliers by purchases
      db.Supplier.findAll({
        where: { businessId: req.user.businessId },
        include: [
          {
            model: db.Purchase,
            as: "purchases",
            attributes: [],
          },
        ],
        attributes: [
          "id",
          "name",
          "phone",
          [
            db.sequelize.fn("COUNT", db.sequelize.col("purchases.id")),
            "purchaseCount",
          ],
          [
            db.sequelize.fn("SUM", db.sequelize.col("purchases.total")),
            "totalAmount",
          ],
        ],
        group: ["Supplier.id"],
        order: [[db.sequelize.literal("totalAmount"), "DESC"]],
        limit: 5,
      }),

      // Suppliers with outstanding balances
      db.Supplier.findAll({
        where: { businessId: req.user.businessId },
        include: [
          {
            model: db.Purchase,
            as: "purchases",
            where: {
              paymentStatus: ["pending", "partial", "overdue"],
            },
            attributes: [],
          },
        ],
        attributes: [
          "id",
          "name",
          "phone",
          [
            db.sequelize.fn("SUM", db.sequelize.col("purchases.total")),
            "outstandingAmount",
          ],
        ],
        group: ["Supplier.id"],
        having: db.sequelize.literal("outstandingAmount > 0"),
        order: [[db.sequelize.literal("outstandingAmount"), "DESC"]],
        limit: 10,
      }),
    ]);

    const summary = {
      totalSuppliers,
      activeSuppliers,
      newSuppliers: dateFrom || dateTo ? newSuppliers : null,
      topSuppliers: topSuppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        purchaseCount: parseInt(supplier.get("purchaseCount")) || 0,
        totalAmount: parseFloat(supplier.get("totalAmount")) || 0,
      })),
      outstandingSuppliers: outstandingSuppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        outstandingAmount: parseFloat(supplier.get("outstandingAmount")) || 0,
      })),
    };

    res.json(
      successResponse("Supplier summary retrieved successfully", { summary })
    );
  } catch (error) {
    console.error("Supplier summary error:", error);
    res
      .status(500)
      .json(
        errorResponse("Failed to retrieve supplier summary", error.message)
      );
  }
});

module.exports = router;
