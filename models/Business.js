module.exports = (sequelize, DataTypes) => {
  const Business = sequelize.define('Business', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 100]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    businessType: {
      type: DataTypes.ENUM(
        'retail', 'wholesale', 'manufacturing',
        'restaurant', 'pharmacy', 'supermarket',
        'fashion', 'electronics', 'other'
      ),
      defaultValue: 'retail'
    },
    industry: {
      type: DataTypes.STRING,
      allowNull: true
    },
    registrationNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    taxNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    currency: {
      type: DataTypes.STRING,
      defaultValue: 'NGN',
      validate: {
        len: [3, 3]
      }
    },
    currencySymbol: {
      type: DataTypes.STRING,
      defaultValue: '₦'
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true
    },
    country: {
      type: DataTypes.STRING,
      defaultValue: 'Nigeria'
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    website: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    logo: {
      // data URL (base64) or remote/path URL — TEXT to match FlowBooks-style logos
      type: DataTypes.TEXT("long"),
      allowNull: true
    },
    primaryColor: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "#0D9488",
    },
    secondaryColor: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "#134E4A",
    },
    taxEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    taxRate: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 0.00,
      validate: {
        min: 0,
        max: 100
      }
    },
    openingCash: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended'),
      defaultValue: 'active'
    },
    subscriptionPlan: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'free'
    },
    subscriptionExpiry: {
      type: DataTypes.DATE,
      allowNull: true
    },
    settings: {
      type: DataTypes.JSON,
      defaultValue: {
        lowStockAlert: true,
        lowStockThreshold: 10,
        expiryAlert: true,
        expiryAlertDays: 30,
        autoReceiptGeneration: true,
        defaultPaymentMethod: 'cash',
        decimalPlaces: 2,
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '12h'
      },
      get() {
        const raw = this.getDataValue('settings');
        if (!raw) return {};
        if (typeof raw === 'object' && !Array.isArray(raw)) {
          // Guard against corrupted string-spread objects ({"0":"{", "1":"\""...})
          const keys = Object.keys(raw);
          if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
            try {
              return JSON.parse(keys.sort((a, b) => a - b).map((k) => raw[k]).join(''));
            } catch {
              return {};
            }
          }
          return raw;
        }
        if (typeof raw === 'string') {
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        }
        return {};
      },
      set(value) {
        if (value == null) {
          this.setDataValue('settings', {});
          return;
        }
        if (typeof value === 'string') {
          try {
            this.setDataValue('settings', JSON.parse(value));
          } catch {
            this.setDataValue('settings', {});
          }
          return;
        }
        this.setDataValue('settings', value);
      },
    },
    taxName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    taxTin: {
      type: DataTypes.STRING,
      allowNull: true
    },
    storefrontSlug: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },
    storefrontEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    squadEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    squadPublicKey: {
      type: DataTypes.STRING,
      allowNull: true
    },
    squadSecretCipher: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    sellingMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "online",
    },
    storefrontSettings: {
      type: DataTypes.JSON,
      defaultValue: {
        tagline: 'Shop with us online',
        shippingFee: 0,
        allowNotes: true
      },
      get() {
        const raw = this.getDataValue('storefrontSettings');
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try {
          return JSON.parse(raw);
        } catch (error) {
          return {};
        }
      }
    },
    referralCode: {
      type: DataTypes.STRING(16),
      allowNull: true,
      unique: true,
    },
    referredByBusinessId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  });

  Business.associate = function(models) {
    Business.belongsTo(models.Business, {
      foreignKey: 'referredByBusinessId',
      as: 'referrer',
    });

    Business.hasMany(models.Business, {
      foreignKey: 'referredByBusinessId',
      as: 'referrals',
    });

    Business.hasMany(models.ReferralCommission, {
      foreignKey: 'referrerBusinessId',
      as: 'referralCommissions',
    });

    // Business has many users
    Business.hasMany(models.User, {
      foreignKey: 'businessId',
      as: 'users'
    });

    // Business has many branches
    Business.hasMany(models.Branch, {
      foreignKey: 'businessId',
      as: 'branches'
    });

    // Business has many products
    Business.hasMany(models.Product, {
      foreignKey: 'businessId',
      as: 'products'
    });

    // Business has many categories
    Business.hasMany(models.Category, {
      foreignKey: 'businessId',
      as: 'categories'
    });

    // Business has many expense categories
    Business.hasMany(models.ExpenseCategory, {
      foreignKey: 'businessId',
      as: 'expenseCategories'
    });

    // Business has many customers
    Business.hasMany(models.Customer, {
      foreignKey: 'businessId',
      as: 'customers'
    });

    // Business has many suppliers
    Business.hasMany(models.Supplier, {
      foreignKey: 'businessId',
      as: 'suppliers'
    });

    Business.hasMany(models.Order, {
      foreignKey: 'businessId',
      as: 'orders'
    });
  };

  return Business;
};

