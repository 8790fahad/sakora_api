const express = require("express");
const { body, query } = require("express-validator");
const {
  validationRules,
  handleValidationErrors,
} = require("../utils/validation");
const { errorResponse, successResponse } = require("../utils/helpers");
const { authenticate, authorize, requirePermission } = require("../middleware/auth");
const db = require("../models");
const { resolveSellingMode } = require("../utils/sellingMode");
const path = require("path");
const fs = require("fs").promises;

const router = express.Router();

function asObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function splitPhoneValues(value) {
  return String(value || "")
    .split(/[\n,;/|]+/)
    .map((phone) => phone.trim())
    .filter(Boolean);
}

function normalizePhones(saved, ...extras) {
  const list = [];
  const push = (value) => {
    splitPhoneValues(value).forEach((phone) => {
      if (phone && !list.includes(phone) && list.length < 30) list.push(phone);
    });
  };
  if (Array.isArray(saved)) saved.forEach(push);
  else push(saved);
  extras.forEach(push);
  return list;
}

function normalizeBankAccounts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = String(item.id || "").trim();
      const bankName = String(item.bankName || "").trim();
      const accountName = String(item.accountName || "").trim();
      const accountNumber = String(item.accountNumber || "")
        .replace(/\s+/g, "")
        .trim();
      if (!id || !bankName || !accountName || !accountNumber) return null;
      return {
        id,
        bankName: bankName.slice(0, 80),
        accountName: accountName.slice(0, 120),
        accountNumber: accountNumber.slice(0, 20),
        isDefault: Boolean(item.isDefault),
      };
    })
    .filter(Boolean);
}

// Get business settings
router.get("/", authenticate, async (req, res) => {
  try {
    // Get business settings
    const business = await db.Business.findByPk(req.user.businessId, {
      attributes: [
        "id",
        "name",
        "description",
        "businessType",
        "address",
        "city",
        "state",
        "country",
        "phone",
        "email",
        "website",
        "logo",
        "registrationNumber",
        "currency",
        "currencySymbol",
        "taxEnabled",
        "taxRate",
        "taxName",
        "taxTin",
        "settings",
      ],
    });

    if (!business) {
      return res.status(404).json(errorResponse("Business not found"));
    }

    // Get user preferences
    const user = await db.User.findByPk(req.user.id, {
      attributes: ["id", "firstName", "lastName", "email", "phone", "preferences"],
    });

    // Default settings structure
    const defaultSettings = {
      business: {
        currency: "NGN",
        taxEnabled: false,
        taxRate: 7.5,
        taxName: "VAT",
        taxTin: "",
        unitsOfMeasure: ["pcs", "kg", "liters", "meters", "boxes", "cartons"],
        receiptSettings: {
          includeBusinessInfo: true,
          includeItemDetails: true,
          includeTaxBreakdown: true,
          includeInvoice: true,
          includeWaybill: true,
          footerText: "Thank you for your business!",
          waybillFooterText: "Thank you for your business!",
          invoice: {
            paperFormat: "a4",
            orientation: "portrait",
            colorMode: "color",
          },
          waybill: {
            paperFormat: "thermal",
            orientation: "portrait",
            colorMode: "mono",
          },
        },
        lowStockThreshold: 10,
        autoBackup: false,
        backupFrequency: "weekly",
      },
      notifications: {
        lowStockAlerts: true,
        overduePayments: true,
        dailyReports: false,
        pushNotifications: true,
        emailNotifications: false,
      },
      display: {
        theme: "light",
        language: "en",
        dateFormat: "DD/MM/YYYY",
        numberFormat: "en-NG",
      },
      security: {
        sessionTimeout: 24, // hours
        requirePasswordChange: false,
        twoFactorEnabled: false,
      },
      pos: {
        defaultPaymentMethod: "cash",
        defaultBankAccountId: null,
      },
    };

    // Merge with saved settings
    const businessSettings = asObject(business.settings);
    const userPreferences = asObject(user.preferences);
    const bankAccounts = normalizeBankAccounts(businessSettings.bankAccounts);

    const settings = {
      business: {
        ...defaultSettings.business,
        ...businessSettings,
        name: business.name || "",
        description: business.description || "",
        businessType: business.businessType || "retail",
        address: business.address || "",
        city: business.city || "",
        state: business.state || "",
        country: business.country || "Nigeria",
        phone: business.phone || user.phone || "",
        phones: normalizePhones(
          businessSettings.phones,
          business.phone,
          user.phone
        ),
        registrationNumber:
          business.getDataValue("registrationNumber") ||
          business.registrationNumber ||
          "",
        logo: business.logo || "",
        email: business.email || user.email || "",
        website: business.website || "",
        currency: business.currency || defaultSettings.business.currency,
        currencySymbol:
          business.currencySymbol || defaultSettings.business.currencySymbol || "₦",
        taxEnabled: Boolean(business.taxEnabled),
        taxRate:
          business.taxRate !== null && business.taxRate !== undefined
            ? parseFloat(business.taxRate)
            : defaultSettings.business.taxRate,
        taxName: business.taxName || defaultSettings.business.taxName,
        taxTin: business.taxTin || defaultSettings.business.taxTin,
        bankAccounts,
        receiptSettings: (() => {
          const defaults = defaultSettings.business.receiptSettings;
          const saved = businessSettings.receiptSettings || {};
          const legacy = {
            paperFormat: saved.paperFormat,
            orientation: saved.orientation,
            colorMode: saved.colorMode,
          };
          return {
            ...defaults,
            ...saved,
            invoice: {
              ...defaults.invoice,
              ...(legacy.paperFormat || legacy.orientation || legacy.colorMode
                ? {
                    paperFormat: legacy.paperFormat || defaults.invoice.paperFormat,
                    orientation:
                      legacy.orientation || defaults.invoice.orientation,
                    colorMode: legacy.colorMode || defaults.invoice.colorMode,
                  }
                : {}),
              ...(saved.invoice || {}),
            },
            waybill: {
              ...defaults.waybill,
              ...(saved.waybill || {}),
            },
          };
        })(),
      },
      bankAccounts,
      profile: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || "",
      },
      notifications: {
        ...defaultSettings.notifications,
        ...userPreferences.notifications,
      },
      display: {
        ...defaultSettings.display,
        ...userPreferences.display,
      },
      security: {
        ...defaultSettings.security,
        ...businessSettings.security,
      },
      pos: {
        ...defaultSettings.pos,
        ...userPreferences.pos,
      },
    };

    res.json(successResponse("Settings retrieved successfully", settings));
  } catch (error) {
    console.error("Get settings error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve settings", error.message));
  }
});

// Update business settings
router.put(
  "/business",
  [
    authenticate,
    requirePermission("settings.manage"),
    body("name").optional().trim().isLength({ min: 2, max: 100 }),
    body("description").optional().trim().isLength({ max: 1000 }),
    body("businessType")
      .optional()
      .isIn([
        "retail",
        "wholesale",
        "manufacturing",
        "restaurant",
        "pharmacy",
        "supermarket",
        "fashion",
        "electronics",
        "other",
      ]),
    body("address").optional().trim().isLength({ max: 500 }),
    body("city").optional().trim().isLength({ max: 100 }),
    body("state").optional().trim().isLength({ max: 100 }),
    body("country").optional().trim().isLength({ max: 100 }),
    body("phone").optional().trim().isLength({ max: 40 }),
    body("phones").optional().isArray({ max: 30 }),
    body("phones.*").optional().trim().isLength({ max: 40 }),
    body("registrationNumber")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 50 }),
    body("logo")
      .optional({ nullable: true, values: "falsy" })
      .custom((value) => {
        if (value == null || value === "") return true;
        if (typeof value !== "string") throw new Error("Logo must be an image");
        if (/^https?:\/\//i.test(value)) {
          if (value.length > 2000) throw new Error("Logo link is too long");
          return true;
        }
        if (value.length > 900000) throw new Error("Logo is too large");
        if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) {
          throw new Error("Logo must be an image");
        }
        return true;
      }),
    body("email").optional({ values: "falsy" }).isEmail().normalizeEmail(),
    body("website")
      .optional({ values: "falsy" })
      .customSanitizer((value) => {
        const site = String(value || "").trim();
        if (!site || /^https?:\/?\/?$/i.test(site)) return "";
        return site;
      })
      .optional({ values: "falsy" })
      .isURL(),
    body("currency").optional().isLength({ min: 3, max: 3 }),
    body("currencySymbol").optional().isLength({ min: 1, max: 5 }),
    body("taxEnabled").optional().isBoolean(),
    body("taxRate").optional().isFloat({ min: 0, max: 100 }),
    body("taxName").optional().isLength({ min: 1, max: 50 }),
    body("taxTin").optional().trim().isLength({ max: 50 }),
    body("settings").optional().isObject(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const {
        name,
        description,
        businessType,
        address,
        city,
        state,
        country,
        phone,
        phones,
        registrationNumber,
        logo,
        email,
        website,
        currency,
        currencySymbol,
        taxEnabled,
        taxRate,
        taxName,
        taxTin,
        settings: additionalSettings,
      } = req.body;

      const business = await db.Business.findByPk(req.user.businessId);
      if (!business) {
        return res.status(404).json(errorResponse("Business not found"));
      }

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (businessType !== undefined) updateData.businessType = businessType;
      if (address !== undefined) updateData.address = address;
      if (city !== undefined) updateData.city = city;
      if (state !== undefined) updateData.state = state;
      if (country !== undefined) updateData.country = country;
      if (phone !== undefined) updateData.phone = phone || null;
      if (phones !== undefined) {
        const list = normalizePhones(phones);
        updateData.phone = list[0] || null;
      }
      if (registrationNumber !== undefined) {
        updateData.registrationNumber = String(registrationNumber || "").trim() || null;
      }
      if (logo !== undefined) updateData.logo = logo || null;
      if (email !== undefined) updateData.email = email || null;
      if (website !== undefined) updateData.website = website || null;
      if (currency !== undefined) {
        updateData.currency = currency;
        const symbols = { NGN: "₦", USD: "$", EUR: "€", GBP: "£" };
        updateData.currencySymbol =
          currencySymbol || symbols[currency] || business.currencySymbol || "₦";
      }
      if (currencySymbol !== undefined) updateData.currencySymbol = currencySymbol;
      if (taxEnabled !== undefined) updateData.taxEnabled = taxEnabled;
      if (taxRate !== undefined) updateData.taxRate = taxRate;
      if (taxName !== undefined) updateData.taxName = taxName;
      if (taxTin !== undefined) updateData.taxTin = taxTin;

      if (additionalSettings || phones !== undefined) {
        const {
          phones: _settingsPhones,
          logo: _settingsLogo,
          name: _settingsName,
          email: _settingsEmail,
          registrationNumber: _settingsRegistration,
          ...restSettings
        } = additionalSettings || {};
        const nextSettings = {
          ...asObject(business.settings),
          ...restSettings,
        };
        if (additionalSettings?.bankAccounts !== undefined) {
          const banks = normalizeBankAccounts(additionalSettings.bankAccounts);
          if (banks.length && !banks.some((b) => b.isDefault)) {
            banks[0].isDefault = true;
          }
          nextSettings.bankAccounts = banks;
        }
        if (phones !== undefined) {
          nextSettings.phones = normalizePhones(phones);
        }
        updateData.settings = nextSettings;
      }

      await business.update(updateData);

      res.json(successResponse("Business settings updated successfully"));
    } catch (error) {
      console.error("Update business settings error:", error);
      if (error.name === "SequelizeUniqueConstraintError") {
        return res
          .status(409)
          .json(errorResponse("That business number is already in use"));
      }
      res
        .status(500)
        .json(
          errorResponse("Failed to update business settings", error.message)
        );
    }
  }
);

// Update user preferences
router.put(
  "/preferences",
  [authenticate, body("preferences").isObject(), handleValidationErrors],
  async (req, res) => {
    try {
      const { preferences } = req.body;

      const user = await db.User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json(errorResponse("User not found"));
      }

      const current = asObject(user.preferences);
      const nextPreferences = {
        ...current,
        ...preferences,
      };
      if (preferences.pos) {
        nextPreferences.pos = {
          ...(current.pos || {}),
          ...preferences.pos,
        };
        if (
          nextPreferences.pos.defaultPaymentMethod !== "bank" &&
          nextPreferences.pos.defaultPaymentMethod !== "cash"
        ) {
          nextPreferences.pos.defaultPaymentMethod = "cash";
        }
        if (nextPreferences.pos.defaultBankAccountId != null) {
          nextPreferences.pos.defaultBankAccountId = String(
            nextPreferences.pos.defaultBankAccountId
          );
        }
      }

      await user.update({ preferences: nextPreferences });

      res.json(successResponse("User preferences updated successfully"));
    } catch (error) {
      console.error("Update user preferences error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to update preferences", error.message));
    }
  }
);

// Export data to CSV
router.get(
  "/export/:type",
  [
    authenticate,
    query("dateFrom").optional().isISO8601(),
    query("dateTo").optional().isISO8601(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { type } = req.params;
      const { dateFrom, dateTo } = req.query;

      // Date range filter
      let whereClause = { businessId: req.user.businessId };
      if (dateFrom && dateTo) {
        whereClause.createdAt = {
          [db.Sequelize.Op.between]: [new Date(dateFrom), new Date(dateTo)],
        };
      }

      let data = [];
      let filename = "";
      let headers = [];

      switch (type) {
        case "products":
          data = await db.Product.findAll({
            where: { businessId: req.user.businessId },
            include: [
              {
                model: db.Category,
                as: "category",
                attributes: ["name"],
              },
              {
                model: db.Inventory,
                as: "inventory",
                attributes: ["quantity", "reorderPoint"],
              },
            ],
          });
          filename = "products_export.csv";
          headers = [
            "Name",
            "SKU",
            "Category",
            "Description",
            "Unit",
            "Cost Price",
            "Selling Price",
            "Current Stock",
            "Reorder Point",
          ];
          data = data.map((product) => [
            product.name,
            product.sku,
            product.category?.name || "",
            product.description || "",
            product.unit,
            product.costPrice,
            product.sellingPrice,
            product.inventory?.[0]?.quantity || 0,
            product.inventory?.[0]?.reorderPoint || 0,
          ]);
          break;

        case "sales":
          data = await db.Sale.findAll({
            where: whereClause,
            include: [
              {
                model: db.Customer,
                as: "customer",
                attributes: ["name"],
              },
              {
                model: db.Branch,
                as: "branch",
                attributes: ["name"],
              },
            ],
            order: [["createdAt", "DESC"]],
          });
          filename = "sales_export.csv";
          headers = [
            "Reference",
            "Date",
            "Customer",
            "Branch",
            "Total Amount",
            "Payment Method",
            "Status",
            "Created At",
          ];
          data = data.map((sale) => [
            sale.reference,
            sale.date.toISOString().split("T")[0],
            sale.customer?.name || "Walk-in",
            sale.branch?.name || "",
            sale.totalAmount,
            sale.paymentMethod,
            sale.paymentStatus,
            sale.createdAt.toISOString(),
          ]);
          break;

        case "purchases":
          data = await db.Purchase.findAll({
            where: whereClause,
            include: [
              {
                model: db.Supplier,
                as: "supplier",
                attributes: ["name"],
              },
              {
                model: db.Branch,
                as: "branch",
                attributes: ["name"],
              },
            ],
            order: [["createdAt", "DESC"]],
          });
          filename = "purchases_export.csv";
          headers = [
            "Reference",
            "Date",
            "Supplier",
            "Branch",
            "Total Amount",
            "Payment Method",
            "Status",
            "Created At",
          ];
          data = data.map((purchase) => [
            purchase.reference,
            purchase.date.toISOString().split("T")[0],
            purchase.supplier?.name || "Unknown",
            purchase.branch?.name || "",
            purchase.totalAmount,
            purchase.paymentMethod,
            purchase.paymentStatus,
            purchase.createdAt.toISOString(),
          ]);
          break;

        case "expenses":
          data = await db.Expense.findAll({
            where: whereClause,
            include: [
              {
                model: db.ExpenseCategory,
                as: "category",
                attributes: ["name"],
              },
              {
                model: db.Branch,
                as: "branch",
                attributes: ["name"],
              },
            ],
            order: [["createdAt", "DESC"]],
          });
          filename = "expenses_export.csv";
          headers = [
            "Date",
            "Description",
            "Category",
            "Branch",
            "Amount",
            "Payment Method",
            "Created At",
          ];
          data = data.map((expense) => [
            expense.date.toISOString().split("T")[0],
            expense.description,
            expense.category?.name || "Uncategorized",
            expense.branch?.name || "",
            expense.amount,
            expense.paymentMethod,
            expense.createdAt.toISOString(),
          ]);
          break;

        case "customers":
          data = await db.Customer.findAll({
            where: { businessId: req.user.businessId },
            attributes: [
              "name",
              "phone",
              "email",
              "address",
              "totalSpent",
              "totalPurchases",
              "createdAt",
            ],
          });
          filename = "customers_export.csv";
          headers = [
            "Name",
            "Phone",
            "Email",
            "Address",
            "Total Spent",
            "Total Purchases",
            "Registered Date",
          ];
          data = data.map((customer) => [
            customer.name,
            customer.phone || "",
            customer.email || "",
            customer.address || "",
            customer.totalSpent || 0,
            customer.totalPurchases || 0,
            customer.createdAt.toISOString().split("T")[0],
          ]);
          break;

        case "suppliers":
          data = await db.Supplier.findAll({
            where: { businessId: req.user.businessId },
            attributes: [
              "name",
              "phone",
              "email",
              "address",
              "totalPurchased",
              "totalTransactions",
              "createdAt",
            ],
          });
          filename = "suppliers_export.csv";
          headers = [
            "Name",
            "Phone",
            "Email",
            "Address",
            "Total Purchased",
            "Total Transactions",
            "Added Date",
          ];
          data = data.map((supplier) => [
            supplier.name,
            supplier.phone || "",
            supplier.email || "",
            supplier.address || "",
            supplier.totalPurchased || 0,
            supplier.totalTransactions || 0,
            supplier.createdAt.toISOString().split("T")[0],
          ]);
          break;

        default:
          return res.status(400).json(errorResponse("Invalid export type"));
      }

      // Generate CSV content
      const csvContent = [
        headers.join(","),
        ...data.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(csvContent);
    } catch (error) {
      console.error("Export data error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to export data", error.message));
    }
  }
);

// Create backup
router.post(
  "/backup",
  [authenticate, authorize(["owner", "manager"])],
  async (req, res) => {
    try {
      const businessId = req.user.businessId;

      // Get all business data
      const [
        business,
        branches,
        users,
        categories,
        products,
        inventory,
        customers,
        suppliers,
        sales,
        purchases,
        expenses,
        expenseCategories,
        cashTransactions,
      ] = await Promise.all([
        db.Business.findByPk(businessId),
        db.Branch.findAll({ where: { businessId } }),
        db.User.findAll({ where: { businessId } }),
        db.Category.findAll({ where: { businessId } }),
        db.Product.findAll({ where: { businessId } }),
        db.Inventory.findAll({ where: { businessId } }),
        db.Customer.findAll({ where: { businessId } }),
        db.Supplier.findAll({ where: { businessId } }),
        db.Sale.findAll({ where: { businessId } }),
        db.Purchase.findAll({ where: { businessId } }),
        db.Expense.findAll({ where: { businessId } }),
        db.ExpenseCategory.findAll({ where: { businessId } }),
        db.CashTransaction.findAll({ where: { businessId } }),
      ]);

      const backup = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        businessId,
        data: {
          business,
          branches,
          users: users.map((u) => ({ ...u.toJSON(), password: undefined })), // Exclude passwords
          categories,
          products,
          inventory,
          customers,
          suppliers,
          sales,
          purchases,
          expenses,
          expenseCategories,
          cashTransactions,
        },
      };

      const filename = `backup_${businessId}_${Date.now()}.json`;

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.json(backup);
    } catch (error) {
      console.error("Create backup error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to create backup", error.message));
    }
  }
);

// Get system info
router.get("/system", authenticate, async (req, res) => {
  try {
    // Get business statistics
    const [
      totalProducts,
      totalCustomers,
      totalSuppliers,
      totalSales,
      totalPurchases,
      totalExpenses,
    ] = await Promise.all([
      db.Product.count({ where: { businessId: req.user.businessId } }),
      db.Customer.count({ where: { businessId: req.user.businessId } }),
      db.Supplier.count({ where: { businessId: req.user.businessId } }),
      db.Sale.count({ where: { businessId: req.user.businessId } }),
      db.Purchase.count({ where: { businessId: req.user.businessId } }),
      db.Expense.count({ where: { businessId: req.user.businessId } }),
    ]);

    const business = await db.Business.findByPk(req.user.businessId, {
      attributes: ["name", "createdAt"],
    });

    const systemInfo = {
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      business: {
        name: business.name,
        createdAt: business.createdAt,
        totalProducts,
        totalCustomers,
        totalSuppliers,
        totalSales,
        totalPurchases,
        totalExpenses,
      },
      server: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
      },
    };

    res.json(successResponse("System info retrieved successfully", systemInfo));
  } catch (error) {
    console.error("Get system info error:", error);
    res
      .status(500)
      .json(errorResponse("Failed to retrieve system info", error.message));
  }
});

// Reset business data (DANGER - Owner only)
router.post(
  "/reset",
  [
    authenticate,
    authorize(["owner"]),
    body("confirmText").equals("DELETE ALL DATA"),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const businessId = req.user.businessId;

      // Use transaction to ensure atomicity
      await db.sequelize.transaction(async (transaction) => {
        // Delete all business data in order (respecting foreign keys)
        await db.SaleItem.destroy({
          where: {
            "$sale.businessId$": businessId,
          },
          include: [{ model: db.Sale, as: "sale" }],
          transaction,
        });

        await db.PurchaseItem.destroy({
          where: {
            "$purchase.businessId$": businessId,
          },
          include: [{ model: db.Purchase, as: "purchase" }],
          transaction,
        });

        await db.Sale.destroy({ where: { businessId }, transaction });
        await db.Purchase.destroy({ where: { businessId }, transaction });
        await db.Expense.destroy({ where: { businessId }, transaction });
        await db.CashTransaction.destroy({
          where: { businessId },
          transaction,
        });
        await db.Inventory.destroy({ where: { businessId }, transaction });
        await db.Product.destroy({ where: { businessId }, transaction });
        await db.Customer.destroy({ where: { businessId }, transaction });
        await db.Supplier.destroy({ where: { businessId }, transaction });
        await db.Category.destroy({ where: { businessId }, transaction });
        await db.ExpenseCategory.destroy({
          where: { businessId },
          transaction,
        });
      });

      res.json(successResponse("All business data has been reset"));
    } catch (error) {
      console.error("Reset business data error:", error);
      res
        .status(500)
        .json(errorResponse("Failed to reset business data", error.message));
    }
  }
);

router.get("/selling-mode", authenticate, async (req, res) => {
  try {
    const business = await db.Business.findByPk(req.user.businessId);
    if (!business) {
      return res.status(404).json(errorResponse("Business not found"));
    }
    const resolved = resolveSellingMode({
      storefrontEnabled: business.storefrontEnabled,
      requested: business.sellingMode,
    });
    res.json(
      successResponse("Selling mode", {
        mode: resolved.mode,
        locked: resolved.locked,
        storefrontEnabled: Boolean(business.storefrontEnabled),
      })
    );
  } catch (error) {
    res.status(500).json(errorResponse("Failed to load selling mode", error.message));
  }
});

router.put("/selling-mode", authenticate, async (req, res) => {
  try {
    const requested = req.body.mode === "hybrid" ? "hybrid" : "online";
    const business = await db.Business.findByPk(req.user.businessId);
    if (!business) {
      return res.status(404).json(errorResponse("Business not found"));
    }
    if (business.storefrontEnabled && requested === "hybrid") {
      return res.status(400).json(
        errorResponse(
          "Turn the storefront off before selling offline. A public shop stays online only."
        )
      );
    }
    await business.update({ sellingMode: requested });
    const resolved = resolveSellingMode({
      storefrontEnabled: business.storefrontEnabled,
      requested,
    });
    res.json(
      successResponse("Selling mode updated", {
        mode: resolved.mode,
        locked: resolved.locked,
        storefrontEnabled: Boolean(business.storefrontEnabled),
      })
    );
  } catch (error) {
    res.status(500).json(errorResponse("Failed to update selling mode", error.message));
  }
});

module.exports = router;
