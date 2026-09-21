module.exports = (sequelize, DataTypes) => {
  const PurchaseItem = sequelize.define('PurchaseItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      validate: {
        min: 0.001
      }
    },
    unitCost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    totalCost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    discountAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  });

  PurchaseItem.associate = function(models) {
    // PurchaseItem belongs to a purchase
    PurchaseItem.belongsTo(models.Purchase, {
      foreignKey: 'purchaseId',
      as: 'purchase'
    });

    // PurchaseItem belongs to a product
    PurchaseItem.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product'
    });
  };

  return PurchaseItem;
};

