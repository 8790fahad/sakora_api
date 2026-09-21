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
      allowNull: true,
      unique: true
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
      type: DataTypes.STRING,
      allowNull: true
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
      type: DataTypes.ENUM('free', 'basic', 'premium'),
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
        autoReceiptGeneration: true,
        defaultPaymentMethod: 'cash',
        decimalPlaces: 2,
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '12h'
      }
    }
  });

  Business.associate = function(models) {
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
  };

  return Business;
};

