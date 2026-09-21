module.exports = (sequelize, DataTypes) => {
  const Purchase = sequelize.define('Purchase', {
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
    purchaseNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: true
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
    paymentMethod: {
      type: DataTypes.ENUM('cash', 'bank', 'credit', 'cheque', 'mobile', 'other'),
      defaultValue: 'cash'
    },
    paymentStatus: {
      type: DataTypes.ENUM('paid', 'partial', 'unpaid'),
      defaultValue: 'unpaid'
    },
    status: {
      type: DataTypes.ENUM('draft', 'pending', 'received', 'cancelled'),
      defaultValue: 'received'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true
    },
    attachments: {
      type: DataTypes.JSON,
      defaultValue: []
    }
  });

  Purchase.associate = function(models) {
    // Purchase belongs to a business
    Purchase.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // Purchase belongs to a branch
    Purchase.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      as: 'branch'
    });

    // Purchase belongs to a supplier
    Purchase.belongsTo(models.Supplier, {
      foreignKey: 'supplierId',
      as: 'supplier'
    });

    // Purchase created by user
    Purchase.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });

    // Purchase has many items
    Purchase.hasMany(models.PurchaseItem, {
      foreignKey: 'purchaseId',
      as: 'items'
    });

    // Purchase has many cash transactions
    Purchase.hasMany(models.CashTransaction, {
      foreignKey: 'referenceId',
      as: 'transactions',
      scope: {
        referenceType: 'purchase'
      }
    });
  };

  // Instance method to calculate balance due
  Purchase.prototype.getBalanceDue = function() {
    return parseFloat(this.total) - parseFloat(this.paidAmount || 0);
  };

  // Instance method to check if fully paid
  Purchase.prototype.isFullyPaid = function() {
    return this.getBalanceDue() <= 0.01;
  };

  return Purchase;
};
