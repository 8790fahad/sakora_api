module.exports = (sequelize, DataTypes) => {
  const Inventory = sequelize.define('Inventory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0.000,
      validate: {
        min: 0
      }
    },
    reservedQuantity: {
      type: DataTypes.DECIMAL(15, 3),
      defaultValue: 0.000,
      validate: {
        min: 0
      }
    },
    reorderPoint: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    maxStock: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    averageCostPrice: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    lastStockUpdate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  });

  Inventory.associate = function(models) {
    // Inventory belongs to a product
    Inventory.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product'
    });

    // Inventory belongs to a branch
    Inventory.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      as: 'branch'
    });
  };

  // Instance method to calculate available quantity
  Inventory.prototype.getAvailableQuantity = function() {
    return parseFloat(this.quantity) - parseFloat(this.reservedQuantity || 0);
  };

  // Instance method to check if stock is low
  Inventory.prototype.isLowStock = function() {
    const available = this.getAvailableQuantity();
    const threshold = this.reorderPoint || this.product?.lowStockThreshold || 10;
    return available <= threshold;
  };

  return Inventory;
};

