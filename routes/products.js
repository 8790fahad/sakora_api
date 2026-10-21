const express = require("express");
const { body, query } = require("express-validator");
const {
  validationRules,
  handleValidationErrors,
} = require("../utils/validation");
const {
  errorResponse,
  successResponse,
  generateSKU,
  getPagination,
  getPagingData,
} = require("../utils/helpers");
const { authenticate, authorize } = require("../middleware/auth");
const db = require("../models");
const {
  pickAllowed,
  assertForBusiness,
  handleTenantError,
} = require("../utils/tenant");

const router = express.Router();

// Get all products with pagination and filters
router.get(
  "/",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().trim(),
    query("category").optional().isUUID(),
    query("status").optional().isIn(["active", "inactive", "discontinued"]),
    query("sortBy")
      .optional()
      .isIn(["name", "createdAt", "sellingPrice", "costPrice"]),
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
        status = "active",
        sortBy = "name",
        sortOrder = "asc",
      } = req.query;

      const { offset, limit: pageLimit } = getPagination(page, limit);

      // Build where clause
      const where = { businessId: req.user.businessId };

      if (search) {
        where[db.Sequelize.Op.or] = [
          { name: { [db.Sequelize.Op.like]: `%${search}%` } },
          { sku: { [db.Sequelize.Op.like]: `%${search}%` } },
          { barcode: { [db.Sequelize.Op.like]: `%${search}%` } },
        ];
      }

      if (category) {
        where.categoryId = category;
      }

      if (status !== "all") {
        where.status = status;
      }

      const products = await db.Product.findAndCountAll({
        where,
        include: [
          {
            model: db.Category,
            as: "category",
            attributes: ["id", "name", "color"],
          },
          {
            model: db.Inventory,
            as: "inventory",
            where: { branchId: req.user.branchId },
            required: false,
            attributes: [
              "quantity",
              "reservedQuantity",
              "reorderPoint",
              "location",
            ],
          },
        ],
        order: [[sortBy, sortOrder.toUpperCase()]],
        limit: pageLimit,
        offset,
        distinct: true,
      });

      const response = getPagingData(
        products.rows,
        page,
        pageLimit,
        products.count
      );

      res.json(successResponse("Products retrieved successfully", response));
    } catch (error) {
      console.error("Products list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve products", error.message));
    }
  }
);

// Get single product with inventory details
router.get(
  "/:id",
  [authenticate, ...validationRules.uuidParam("id"), handleValidationErrors],
  async (req, res) => {
    try {
      const { id } = req.params;

      const product = await db.Product.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
        include: [
          {
            model: db.Category,
            as: "category",
            attributes: ["id", "name", "color", "icon"],
          },
          {
            model: db.Inventory,
            as: "inventory",
            include: [
              {
                model: db.Branch,
                as: "branch",
                attributes: ["id", "name"],
              },
            ],
          },
        ],
      });

      if (!product) {
        return res.status(404).json(errorResponse("Product not found"));
      }

      res.json(successResponse("Product retrieved successfully", { product }));
    } catch (error) {
      console.error("Product details error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve product", error.message));
    }
  }
);

// Create new product
router.post(
  "/",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.productCreation,
    body("categoryId").optional().isUUID(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const {
        name,
        sku,
        barcode,
        description,
        categoryId,
        unit = "piece",
        costPrice,
        sellingPrice,
        minSellingPrice,
        lowStockThreshold = 10,
        trackInventory = true,
        image,
        tags = [],
        attributes = {},
        openingStock = 0,
        isOnline = true,
        isFeatured = false,
      } = req.body;

      // Check if SKU already exists
      if (sku) {
        const existingProduct = await db.Product.findOne({
          where: {
            sku,
            businessId: req.user.businessId,
          },
        });

        if (existingProduct) {
          await transaction.rollback();
          return res
            .status(400)
            .json(errorResponse("Product with this SKU already exists"));
        }
      }

      // Check if barcode already exists
      if (barcode) {
        const existingProduct = await db.Product.findOne({
          where: {
            barcode,
            businessId: req.user.businessId,
          },
        });

        if (existingProduct) {
          await transaction.rollback();
          return res
            .status(400)
            .json(errorResponse("Product with this barcode already exists"));
        }
      }

      // Generate SKU if not provided
      let productSKU = sku;
      if (!productSKU) {
        const category = categoryId
          ? await db.Category.findByPk(categoryId)
          : null;
        productSKU = generateSKU(name, category?.name);
      }

      // Create product
      const product = await db.Product.create(
        {
          businessId: req.user.businessId,
          name,
          sku: productSKU,
          barcode,
          description,
          categoryId,
          unit,
          costPrice,
          sellingPrice,
          minSellingPrice,
          lowStockThreshold,
          trackInventory,
          image,
          tags,
          attributes,
          isOnline,
          isFeatured,
        },
        { transaction }
      );

      // Create inventory record for current branch if tracking inventory
      if (trackInventory) {
        await db.Inventory.create(
          {
            productId: product.id,
            branchId: req.user.branchId,
            quantity: openingStock || 0,
            reorderPoint: lowStockThreshold,
            averageCostPrice: costPrice,
            lastStockUpdate: new Date(),
          },
          { transaction }
        );

        // If opening stock > 0, create opening stock transaction
        if (openingStock > 0) {
          await db.CashTransaction.create(
            {
              businessId: req.user.businessId,
              branchId: req.user.branchId,
              type: "out",
              amount: parseFloat(openingStock) * parseFloat(costPrice),
              description: `Opening stock - ${name}`,
              referenceType: "opening_balance",
              referenceId: null, // Opening balance doesn't reference a purchase
              paymentMethod: "cash",
              runningBalance: 0, // Will be calculated by helper
              createdBy: req.user.id,
            },
            { transaction }
          );
        }
      }

      await transaction.commit();

      // Return product with inventory
      const productWithInventory = await db.Product.findByPk(product.id, {
        include: [
          { model: db.Category, as: "category" },
          { model: db.Inventory, as: "inventory" },
        ],
      });

      res.status(201).json(
        successResponse("Product created successfully", {
          product: productWithInventory,
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Product creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create product", error.message));
    }
  }
);

// Update product
router.put(
  "/:id",
  [
    authenticate,
    authorize(["owner", "manager"]),
    ...validationRules.uuidParam("id"),
    body("name").optional().trim().isLength({ min: 2, max: 100 }),
    body("costPrice").optional().isFloat({ min: 0 }),
    body("sellingPrice").optional().isFloat({ min: 0 }),
    body("categoryId").optional().isUUID(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = pickAllowed(req.body, [
        "name",
        "sku",
        "barcode",
        "description",
        "categoryId",
        "unit",
        "costPrice",
        "sellingPrice",
        "minSellingPrice",
        "lowStockThreshold",
        "trackInventory",
        "image",
        "tags",
        "attributes",
        "status",
        "isOnline",
        "isFeatured",
      ]);

      const product = await db.Product.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!product) {
        return res.status(404).json(errorResponse("Product not found"));
      }

      if (updates.categoryId) {
        await assertForBusiness(
          db.Category,
          updates.categoryId,
          req.user.businessId,
          "Category"
        );
      }

      // Check SKU uniqueness if being updated
      if (updates.sku && updates.sku !== product.sku) {
        const existingSKU = await db.Product.findOne({
          where: {
            sku: updates.sku,
            businessId: req.user.businessId,
            id: { [db.Sequelize.Op.ne]: id },
          },
        });

        if (existingSKU) {
          return res
            .status(400)
            .json(errorResponse("Product with this SKU already exists"));
        }
      }

      // Check barcode uniqueness if being updated
      if (updates.barcode && updates.barcode !== product.barcode) {
        const existingBarcode = await db.Product.findOne({
          where: {
            barcode: updates.barcode,
            businessId: req.user.businessId,
            id: { [db.Sequelize.Op.ne]: id },
          },
        });

        if (existingBarcode) {
          return res
            .status(400)
            .json(errorResponse("Product with this barcode already exists"));
        }
      }

      await product.update(updates);

      // Get updated product with relations
      const updatedProduct = await db.Product.findByPk(id, {
        include: [
          { model: db.Category, as: "category" },
          {
            model: db.Inventory,
            as: "inventory",
            where: { branchId: req.user.branchId },
            required: false,
          },
        ],
      });

      res.json(
        successResponse("Product updated successfully", {
          product: updatedProduct,
        })
      );
    } catch (error) {
      if (handleTenantError(res, error)) return;
      console.error("Product update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update product", error.message));
    }
  }
);

// Delete product
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

      const product = await db.Product.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!product) {
        await transaction.rollback();
        return res.status(404).json(errorResponse("Product not found"));
      }

      // Check if product has been used in sales or purchases
      const [salesCount, purchaseCount] = await Promise.all([
        db.SaleItem.count({ where: { productId: id } }),
        db.PurchaseItem.count({ where: { productId: id } }),
      ]);

      if (salesCount > 0 || purchaseCount > 0) {
        // Don't delete, just mark as discontinued
        await product.update({ status: "discontinued" }, { transaction });
        await transaction.commit();

        res.json(
          successResponse(
            "Product marked as discontinued (has transaction history)"
          )
        );
      } else {
        // Safe to delete - remove inventory records first
        await db.Inventory.destroy({ where: { productId: id }, transaction });
        await product.destroy({ transaction });
        await transaction.commit();

        res.json(successResponse("Product deleted successfully"));
      }
    } catch (error) {
      await transaction.rollback();
      console.error("Product deletion error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to delete product", error.message));
    }
  }
);

// Get product categories
router.get("/categories/list", authenticate, async (req, res) => {
  try {
    const categories = await db.Category.findAll({
      where: { businessId: req.user.businessId },
      order: [["name", "ASC"]],
      include: [
        {
          model: db.Product,
          as: "products",
          attributes: ["id"],
          where: { status: "active" },
          required: false,
        },
      ],
    });

    // Add product count to each category
    const categoriesWithCount = categories.map((category) => ({
      ...category.toJSON(),
      productCount: category.products?.length || 0,
    }));

    res.json(
      successResponse("Categories retrieved successfully", {
        categories: categoriesWithCount,
      })
    );
  } catch (error) {
    console.error("Categories list error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve categories", error.message));
  }
});

// Create product category
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
      const { name, description, color = "#3B82F6", icon } = req.body;

      // Check if category name already exists
      const existingCategory = await db.Category.findOne({
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

      const category = await db.Category.create({
        businessId: req.user.businessId,
        name,
        description,
        color,
        icon,
      });

      res
        .status(201)
        .json(successResponse("Category created successfully", { category }));
    } catch (error) {
      console.error("Category creation error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create category", error.message));
    }
  }
);

// Update category
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

      const category = await db.Category.findOne({
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
        const existingName = await db.Category.findOne({
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

      res.json(successResponse("Category updated successfully", { category }));
    } catch (error) {
      console.error("Category update error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update category", error.message));
    }
  }
);

// Delete category
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

      const category = await db.Category.findOne({
        where: {
          id,
          businessId: req.user.businessId,
        },
      });

      if (!category) {
        return res.status(404).json(errorResponse("Category not found"));
      }

      // Check if category has products
      const productCount = await db.Product.count({
        where: { categoryId: id },
      });

      if (productCount > 0) {
        return res
          .status(400)
          .json(
            errorResponse(
              `Cannot delete category with ${productCount} products`
            )
          );
      }

      await category.destroy();

      res.json(successResponse("Category deleted successfully"));
    } catch (error) {
      console.error("Category deletion error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to delete category", error.message));
    }
  }
);

const PRODUCT_UNITS = [
  "piece",
  "kg",
  "g",
  "liter",
  "ml",
  "meter",
  "cm",
  "box",
  "pack",
  "dozen",
  "other",
];

const normalizeUnit = (value) => {
  const raw = String(value || "piece")
    .trim()
    .toLowerCase();
  if (!raw) return "piece";
  if (raw === "pcs" || raw === "pc" || raw === "pieces") return "piece";
  if (raw === "ltr" || raw === "l") return "liter";
  if (PRODUCT_UNITS.includes(raw)) return raw;
  return "other";
};

const resolveCategoryId = async (row, businessId, cache, transaction) => {
  if (row.categoryId && cache.byId.has(row.categoryId)) {
    return row.categoryId;
  }

  const label = String(row.category || row.categoryName || "").trim();
  if (!label) return null;

  const key = label.toLowerCase();
  if (cache.byName.has(key)) return cache.byName.get(key);

  if (label.length < 2) {
    throw new Error("Category name must be at least 2 characters");
  }

  const category = await db.Category.create(
    {
      businessId,
      name: label.slice(0, 50),
      color: "#0D9488",
      status: "active",
    },
    { transaction }
  );

  cache.byName.set(key, category.id);
  cache.byId.set(category.id, category.id);
  return category.id;
};

// Bulk import products (from Excel/CSV mapped rows)
router.post(
  "/bulk-import",
  [
    authenticate,
    authorize(["owner", "manager"]),
    body("products").isArray({ min: 1, max: 500 }),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { products } = req.body;
      const imported = [];
      const errors = [];
      const usedSkus = new Set();
      const existingCategories = await db.Category.findAll({
        where: { businessId: req.user.businessId },
        transaction,
      });
      const categoryCache = {
        byName: new Map(
          existingCategories.map((c) => [String(c.name).toLowerCase(), c.id])
        ),
        byId: new Map(existingCategories.map((c) => [c.id, c.id])),
      };

      for (let i = 0; i < products.length; i++) {
        const row = products[i] || {};
        const rowNumber = i + 1;

        try {
          const name = String(row.name || "").trim();
          const costPrice = parseFloat(row.costPrice);
          const sellingPrice = parseFloat(row.sellingPrice);

          if (name.length < 2) {
            throw new Error("Name is required (min 2 characters)");
          }
          if (!Number.isFinite(costPrice) || costPrice < 0) {
            throw new Error("Valid cost price is required");
          }
          if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
            throw new Error("Valid selling price is required");
          }

          const categoryId = await resolveCategoryId(
            row,
            req.user.businessId,
            categoryCache,
            transaction
          );

          let sku = String(row.sku || "").trim() || null;
          if (!sku) {
            const category = categoryId
              ? await db.Category.findByPk(categoryId, { transaction })
              : null;
            sku = generateSKU(name, category?.name);
          }

          if (usedSkus.has(sku)) {
            throw new Error(`Duplicate SKU in file: ${sku}`);
          }

          const existingSku = await db.Product.findOne({
            where: { sku, businessId: req.user.businessId },
            transaction,
          });
          if (existingSku) {
            throw new Error(`SKU already exists: ${sku}`);
          }

          const barcode = String(row.barcode || "").trim() || null;
          if (barcode) {
            const existingBarcode = await db.Product.findOne({
              where: { barcode, businessId: req.user.businessId },
              transaction,
            });
            if (existingBarcode) {
              throw new Error(`Barcode already exists: ${barcode}`);
            }
          }

          const lowStockThreshold = Number.isFinite(
            parseInt(row.lowStockThreshold, 10)
          )
            ? Math.max(0, parseInt(row.lowStockThreshold, 10))
            : 10;
          const openingStock = Number.isFinite(parseFloat(row.openingStock))
            ? Math.max(0, parseFloat(row.openingStock))
            : 0;
          const trackInventory = row.trackInventory !== false;
          const unit = normalizeUnit(row.unit);
          const expiryDate = row.expiryDate
            ? String(row.expiryDate).slice(0, 10)
            : null;

          const product = await db.Product.create(
            {
              businessId: req.user.businessId,
              name,
              sku,
              barcode,
              description: row.description
                ? String(row.description).trim()
                : null,
              categoryId,
              unit,
              costPrice,
              sellingPrice,
              minSellingPrice:
                row.minSellingPrice != null && row.minSellingPrice !== ""
                  ? parseFloat(row.minSellingPrice)
                  : null,
              lowStockThreshold,
              expiryDate: expiryDate || null,
              trackInventory,
              isOnline: row.isOnline !== false,
              status: "active",
            },
            { transaction }
          );

          usedSkus.add(sku);

          if (trackInventory) {
            await db.Inventory.create(
              {
                productId: product.id,
                branchId: req.user.branchId,
                quantity: openingStock,
                reorderPoint: lowStockThreshold,
                averageCostPrice: costPrice,
                lastStockUpdate: new Date(),
              },
              { transaction }
            );
          }

          imported.push(product);
        } catch (error) {
          errors.push({
            row: rowNumber,
            name: row.name || null,
            error: error.message,
          });
        }
      }

      if (errors.length > 0) {
        await transaction.rollback();
        const first = errors[0];
        const summary = `Row ${first.row}${
          first.name ? ` (${first.name})` : ""
        }: ${first.error}${
          errors.length > 1 ? ` (+${errors.length - 1} more)` : ""
        }`;
        return res.status(400).json(
          errorResponse(summary, {
            errors,
            importedCount: 0,
          })
        );
      }

      await transaction.commit();
      res.json(
        successResponse(`Successfully imported ${imported.length} products`, {
          importedCount: imported.length,
          imported,
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Bulk import error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to import products", error.message));
    }
  }
);

module.exports = router;
