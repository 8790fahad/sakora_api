module.exports = (sequelize, DataTypes) => {
  const Sale = sequelize.define('Sale', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'business_id'
    },
    saleNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    time: {
      type: DataTypes.TIME,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    subtotal: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    taxAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
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
    total: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    paidAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    changeAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      validate: {
        min: 0
      }
    },
    paymentMethod: {
      type: DataTypes.ENUM('cash', 'card', 'bank', 'credit', 'mobile', 'other'),
      defaultValue: 'cash'
    },
    paymentStatus: {
      type: DataTypes.ENUM('paid', 'partial', 'unpaid'),
      defaultValue: 'paid'
    },
    status: {
      type: DataTypes.ENUM('completed', 'pending', 'cancelled', 'refunded'),
      defaultValue: 'completed'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    receiptGenerated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    receiptNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    customerPhone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      }
    }
  });

  Sale.associate = function(models) {
    // Sale belongs to a business
    Sale.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // Sale belongs to a branch
    Sale.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      as: 'branch'
    });

    // Sale belongs to a customer (optional)
    Sale.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });

    // Sale created by user
    Sale.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });

    // Sale has many items
    Sale.hasMany(models.SaleItem, {
      foreignKey: 'saleId',
      as: 'items'
    });

    // Sale has many cash transactions
    Sale.hasMany(models.CashTransaction, {
      foreignKey: 'referenceId',
      as: 'transactions',
      scope: {
        referenceType: 'sale'
      }
    });
  };

  // Instance method to calculate balance due
  Sale.prototype.getBalanceDue = function() {
    return parseFloat(this.total) - parseFloat(this.paidAmount || 0);
  };

  // Instance method to check if fully paid
  Sale.prototype.isFullyPaid = function() {
    return this.getBalanceDue() <= 0.01;
  };

  return Sale;
};
