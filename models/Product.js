module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define('Product', {
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
    sku: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },
    barcode: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    unit: {
      type: DataTypes.STRING,
      defaultValue: 'piece',
      validate: {
        isIn: [['piece', 'kg', 'g', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'dozen', 'other']]
      }
    },
    costPrice: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    sellingPrice: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    minSellingPrice: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true
    },
    lowStockThreshold: {
      type: DataTypes.INTEGER,
      defaultValue: 10,
      validate: {
        min: 0
      }
    },
    expiryDate: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    trackInventory: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'discontinued'),
      defaultValue: 'active'
    },
    tags: {
      type: DataTypes.JSON,
      defaultValue: []
    },
    attributes: {
      type: DataTypes.JSON,
      defaultValue: {}
    },
    isOnline: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    isFeatured: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  });

  Product.associate = function(models) {
    // Product belongs to a business
    Product.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // Product belongs to a category
    Product.belongsTo(models.Category, {
      foreignKey: 'categoryId',
      as: 'category'
    });

    // Product has many inventory records
    Product.hasMany(models.Inventory, {
      foreignKey: 'productId',
      as: 'inventory'
    });

    // Product has many sale items
    Product.hasMany(models.SaleItem, {
      foreignKey: 'productId',
      as: 'saleItems'
    });

    // Product has many purchase items
    Product.hasMany(models.PurchaseItem, {
      foreignKey: 'productId',
      as: 'purchaseItems'
    });

    Product.hasMany(models.OrderItem, {
      foreignKey: 'productId',
      as: 'orderItems'
    });
  };

  return Product;
};

