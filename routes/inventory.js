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

// Get inventory for current branch
router.get(
  "/",
  [
    authenticate,
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().trim(),
    query("category").optional().isUUID(),
    query("lowStock").optional().isBoolean(),
    query("sortBy").optional().isIn(["name", "quantity", "value"]),
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
        lowStock,
        sortBy = "name",
        sortOrder = "asc",
      } = req.query;

      const { offset, limit: pageLimit } = getPagination(page, limit);

      // Build product where clause
      const productWhere = {
        businessId: req.user.businessId,
        status: "active",
      };

      if (search) {
        productWhere[db.Sequelize.Op.or] = [
          { name: { [db.Sequelize.Op.like]: `%${search}%` } },
          { sku: { [db.Sequelize.Op.like]: `%${search}%` } },
        ];
      }

      if (category) {
        productWhere.categoryId = category;
      }

      // Build inventory where clause
      const inventoryWhere = { branchId: req.user.branchId };

      const inventory = await db.Inventory.findAndCountAll({
        where: inventoryWhere,
        include: [
          {
            model: db.Product,
            as: "product",
            where: productWhere,
            include: [
              {
                model: db.Category,
                as: "category",
                attributes: ["id", "name", "color"],
              },
            ],
          },
          {
            model: db.Branch,
            as: "branch",
            attributes: ["id", "name"],
          },
        ],
        order: [
          sortBy === "name"
            ? [
                { model: db.Product, as: "product" },
                "name",
                sortOrder.toUpperCase(),
              ]
            : sortBy === "quantity"
            ? ["quantity", sortOrder.toUpperCase()]
            : [
                db.sequelize.literal("(quantity * product.cost_price)"),
                sortOrder.toUpperCase(),
              ],
        ],
        limit: pageLimit,
        offset,
        distinct: true,
      });

      // Filter low stock if requested
      let filteredRows = inventory.rows;
      if (lowStock === "true") {
        filteredRows = inventory.rows.filter((item) => {
          const available = item.getAvailableQuantity();
          const threshold =
            item.reorderPoint || item.product.lowStockThreshold || 10;
          return available <= threshold;
        });
      }

      const response = getPagingData(
        filteredRows,
        page,
        pageLimit,
        filteredRows.length
      );

      // Add computed fields
      response.items = response.items.map((item) => ({
        ...item.toJSON(),
        availableQuantity: item.getAvailableQuantity(),
        stockValue:
          parseFloat(item.quantity) * parseFloat(item.product.costPrice),
        isLowStock: item.isLowStock(),
      }));

      res.json(successResponse("Inventory retrieved successfully", response));
    } catch (error) {
      console.error("Inventory list error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to retrieve inventory", error.message));
    }
  }
);

// Get inventory for specific product
router.get(
  "/product/:productId",
  [
    authenticate,
    ...validationRules.uuidParam("productId"),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { productId } = req.params;

      const inventory = await db.Inventory.findAll({
        where: { productId },
        include: [
          {
            model: db.Product,
            as: "product",
            where: { businessId: req.user.businessId },
            include: [{ model: db.Category, as: "category" }],
          },
          {
            model: db.Branch,
            as: "branch",
            where: { businessId: req.user.businessId },
          },
        ],
      });

      if (inventory.length === 0) {
        return res
          .status(404)
          .json(errorResponse("Product inventory not found"));
      }

      // Calculate totals across all branches
      const totals = inventory.reduce(
        (acc, item) => ({
          totalQuantity: acc.totalQuantity + parseFloat(item.quantity),
          totalReserved:
            acc.totalReserved + parseFloat(item.reservedQuantity || 0),
          totalValue:
            acc.totalValue +
            parseFloat(item.quantity) * parseFloat(item.product.costPrice),
        }),
        { totalQuantity: 0, totalReserved: 0, totalValue: 0 }
      );

      const inventoryWithComputedFields = inventory.map((item) => ({
        ...item.toJSON(),
        availableQuantity: item.getAvailableQuantity(),
        stockValue:
          parseFloat(item.quantity) * parseFloat(item.product.costPrice),
        isLowStock: item.isLowStock(),
      }));

      res.json(
        successResponse("Product inventory retrieved successfully", {
          inventory: inventoryWithComputedFields,
          totals,
        })
      );
    } catch (error) {
      console.error("Product inventory error:", error);
      res
        .status(500)
        .json(
          errorResponse("Failed to retrieve product inventory", error.message)
        );
    }
  }
);

// Adjust inventory (stock in/out, corrections, damage, etc.)
router.post(
  "/:id/adjust",
  [
    authenticate,
    authorize(["owner", "manager", "staff"]),
    ...validationRules.uuidParam("id"),
    body("type").isIn(["in", "out", "adjustment", "damage", "return"]),
    body("quantity").isFloat({ min: 0.001 }),
    body("reason").trim().isLength({ min: 2, max: 200 }),
    body("cost").optional().isFloat({ min: 0 }),
    body("referenceNumber").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { id } = req.params;
      const { type, quantity, reason, cost, referenceNumber, notes } = req.body;

      const inventory = await db.Inventory.findOne({
        where: {
          id,
          branchId: req.user.branchId,
        },
        include: [
          {
            model: db.Product,
            as: "product",
            where: { businessId: req.user.businessId },
          },
        ],
      });

      if (!inventory) {
        await transaction.rollback();
        return res.status(404).json(errorResponse("Inventory item not found"));
      }

      const adjustmentQty = parseFloat(quantity);
      const oldQuantity = parseFloat(inventory.quantity);
      let newQuantity = oldQuantity;

      // Calculate new quantity based on adjustment type
      switch (type) {
        case "in":
        case "return":
          newQuantity = oldQuantity + adjustmentQty;
          break;
        case "out":
        case "damage":
          newQuantity = oldQuantity - adjustmentQty;
          break;
        case "adjustment":
          newQuantity = adjustmentQty; // Direct adjustment to specific quantity
          break;
      }

      // Validate new quantity
      if (newQuantity < 0) {
        await transaction.rollback();
        return res
          .status(400)
          .json(errorResponse("Insufficient stock for this adjustment"));
      }

      // Update inventory
      await inventory.update(
        {
          quantity: newQuantity,
          averageCostPrice: cost || inventory.averageCostPrice,
          lastStockUpdate: new Date(),
          notes: notes || inventory.notes,
        },
        { transaction }
      );

      // Create cash transaction for stock adjustments that affect value
      if ((type === "in" || type === "damage") && cost) {
        const transactionAmount = adjustmentQty * parseFloat(cost);
        const runningBalance = await updateCashBalance(
          req.user.branchId,
          transactionAmount,
          type === "in" ? "out" : "in", // Stock in = cash out, damage = write-off
          db
        );

        await db.CashTransaction.create(
          {
            businessId: req.user.businessId,
            branchId: req.user.branchId,
            type: type === "in" ? "out" : "in",
            amount: transactionAmount,
            description: `Stock ${type} - ${inventory.product.name} (${reason})`,
            referenceType: "adjustment",
            referenceId: inventory.id,
            referenceNumber,
            paymentMethod: "adjustment",
            runningBalance,
            notes: notes,
            createdBy: req.user.id,
          },
          { transaction }
        );
      }

      // Log the inventory adjustment
      // Note: In a full system, you'd have an InventoryAdjustment table to track all changes
      // For now, we'll track via cash transactions and inventory update timestamps

      await transaction.commit();

      // Get updated inventory with product details
      const updatedInventory = await db.Inventory.findByPk(inventory.id, {
        include: [
          {
            model: db.Product,
            as: "product",
            include: [{ model: db.Category, as: "category" }],
          },
          { model: db.Branch, as: "branch" },
        ],
      });

      const inventoryData = {
        ...updatedInventory.toJSON(),
        availableQuantity: updatedInventory.getAvailableQuantity(),
        stockValue:
          parseFloat(updatedInventory.quantity) *
          parseFloat(updatedInventory.product.costPrice),
        isLowStock: updatedInventory.isLowStock(),
        adjustment: {
          type,
          oldQuantity,
          newQuantity,
          adjustmentQuantity:
            type === "adjustment" ? newQuantity - oldQuantity : adjustmentQty,
          reason,
        },
      };

      res.json(
        successResponse("Inventory adjusted successfully", {
          inventory: inventoryData,
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Inventory adjustment error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to adjust inventory", error.message));
    }
  }
);

// Get low stock items
router.get("/low-stock", authenticate, async (req, res) => {
  try {
    const inventory = await db.Inventory.findAll({
      where: { branchId: req.user.branchId },
      include: [
        {
          model: db.Product,
          as: "product",
          where: {
            businessId: req.user.businessId,
            status: "active",
            trackInventory: true,
          },
          include: [{ model: db.Category, as: "category" }],
        },
      ],
    });

    // Filter items that are below reorder point
    const lowStockItems = inventory
      .filter((item) => {
        const available = item.getAvailableQuantity();
        const threshold =
          item.reorderPoint || item.product.lowStockThreshold || 10;
        return available <= threshold;
      })
      .map((item) => ({
        ...item.toJSON(),
        availableQuantity: item.getAvailableQuantity(),
        reorderPoint: item.reorderPoint || item.product.lowStockThreshold,
        stockValue:
          parseFloat(item.quantity) * parseFloat(item.product.costPrice),
      }));

    res.json(
      successResponse("Low stock items retrieved successfully", {
        items: lowStockItems,
        count: lowStockItems.length,
      })
    );
  } catch (error) {
    console.error("Low stock error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve low stock items", error.message));
  }
});

// Get inventory valuation
router.get("/valuation", authenticate, async (req, res) => {
  try {
    const inventory = await db.Inventory.findAll({
      where: { branchId: req.user.branchId },
      include: [
        {
          model: db.Product,
          as: "product",
          where: {
            businessId: req.user.businessId,
            status: "active",
          },
          include: [{ model: db.Category, as: "category" }],
        },
      ],
    });

    // Calculate valuation by category
    const valuationByCategory = {};
    let totalCostValue = 0;
    let totalSellingValue = 0;
    let totalItems = 0;

    inventory.forEach((item) => {
      const quantity = parseFloat(item.quantity);
      const costPrice = parseFloat(item.product.costPrice);
      const sellingPrice = parseFloat(item.product.sellingPrice);
      const categoryName = item.product.category?.name || "Uncategorized";

      const costValue = quantity * costPrice;
      const sellingValue = quantity * sellingPrice;

      totalCostValue += costValue;
      totalSellingValue += sellingValue;
      totalItems += quantity;

      if (!valuationByCategory[categoryName]) {
        valuationByCategory[categoryName] = {
          categoryId: item.product.category?.id,
          categoryName,
          categoryColor: item.product.category?.color || "#6B7280",
          items: 0,
          quantity: 0,
          costValue: 0,
          sellingValue: 0,
          products: [],
        };
      }

      valuationByCategory[categoryName].items += 1;
      valuationByCategory[categoryName].quantity += quantity;
      valuationByCategory[categoryName].costValue += costValue;
      valuationByCategory[categoryName].sellingValue += sellingValue;
      valuationByCategory[categoryName].products.push({
        id: item.product.id,
        name: item.product.name,
        sku: item.product.sku,
        quantity,
        costPrice,
        sellingPrice,
        costValue,
        sellingValue,
      });
    });

    const valuation = {
      summary: {
        totalItems,
        totalProducts: inventory.length,
        totalCostValue,
        totalSellingValue,
        potentialProfit: totalSellingValue - totalCostValue,
        profitMargin:
          totalSellingValue > 0
            ? ((totalSellingValue - totalCostValue) / totalSellingValue) * 100
            : 0,
      },
      categories: Object.values(valuationByCategory).map((category) => ({
        ...category,
        profitMargin:
          category.sellingValue > 0
            ? ((category.sellingValue - category.costValue) /
                category.sellingValue) *
              100
            : 0,
      })),
      lastUpdated: new Date(),
    };

    res.json(
      successResponse("Inventory valuation retrieved successfully", {
        valuation,
      })
    );
  } catch (error) {
    console.error("Inventory valuation error:", error);
    res
      .status(500)
      .json(
        errorResponse("Failed to calculate inventory valuation", error.message)
      );
  }
});

// Transfer stock between branches
router.post(
  "/transfer",
  [
    authenticate,
    authorize(["owner", "manager"]),
    body("productId").isUUID(),
    body("fromBranchId").isUUID(),
    body("toBranchId").isUUID(),
    body("quantity").isFloat({ min: 0.001 }),
    body("reason").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    const transaction = await db.sequelize.transaction();

    try {
      const { productId, fromBranchId, toBranchId, quantity, reason } =
        req.body;

      if (fromBranchId === toBranchId) {
        await transaction.rollback();
        return res
          .status(400)
          .json(errorResponse("Cannot transfer to the same branch"));
      }

      // Verify both branches belong to user's business
      const branches = await db.Branch.findAll({
        where: {
          id: [fromBranchId, toBranchId],
          businessId: req.user.businessId,
        },
      });

      if (branches.length !== 2) {
        await transaction.rollback();
        return res.status(400).json(errorResponse("Invalid branch selection"));
      }

      // Get source inventory
      const sourceInventory = await db.Inventory.findOne({
        where: {
          productId,
          branchId: fromBranchId,
        },
        include: [{ model: db.Product, as: "product" }],
      });

      if (!sourceInventory) {
        await transaction.rollback();
        return res
          .status(404)
          .json(errorResponse("Source inventory not found"));
      }

      if (sourceInventory.getAvailableQuantity() < parseFloat(quantity)) {
        await transaction.rollback();
        return res
          .status(400)
          .json(errorResponse("Insufficient stock in source branch"));
      }

      // Get or create destination inventory
      let destInventory = await db.Inventory.findOne({
        where: {
          productId,
          branchId: toBranchId,
        },
      });

      if (!destInventory) {
        destInventory = await db.Inventory.create(
          {
            productId,
            branchId: toBranchId,
            quantity: 0,
            averageCostPrice: sourceInventory.averageCostPrice,
          },
          { transaction }
        );
      }

      // Update quantities
      await sourceInventory.update(
        {
          quantity: parseFloat(sourceInventory.quantity) - parseFloat(quantity),
        },
        { transaction }
      );

      await destInventory.update(
        {
          quantity: parseFloat(destInventory.quantity) + parseFloat(quantity),
        },
        { transaction }
      );

      await transaction.commit();

      res.json(
        successResponse("Stock transferred successfully", {
          transfer: {
            productId,
            fromBranch: branches.find((b) => b.id === fromBranchId).name,
            toBranch: branches.find((b) => b.id === toBranchId).name,
            quantity: parseFloat(quantity),
            reason,
          },
        })
      );
    } catch (error) {
      await transaction.rollback();
      console.error("Stock transfer error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to transfer stock", error.message));
    }
  }
);

module.exports = router;
