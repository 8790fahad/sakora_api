module.exports = (sequelize, DataTypes) => {
  const CashTransaction = sequelize.define('CashTransaction', {
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
    type: {
      type: DataTypes.ENUM('in', 'out'),
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: {
        min: 0.01
      }
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 200]
      }
    },
    referenceType: {
      type: DataTypes.ENUM('sale', 'purchase', 'expense', 'opening_balance', 'adjustment', 'other'),
      allowNull: false
    },
    referenceId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    referenceNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    paymentMethod: {
      type: DataTypes.ENUM('cash', 'bank', 'card', 'cheque', 'mobile', 'other'),
      defaultValue: 'cash'
    },
    runningBalance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isReconciled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    receiptNumber: {
      type: DataTypes.STRING,
      allowNull: true
    }
  });

  CashTransaction.associate = function(models) {
    // CashTransaction belongs to a business
    CashTransaction.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // CashTransaction belongs to a branch
    CashTransaction.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      as: 'branch'
    });

    // CashTransaction created by user
    CashTransaction.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });
  };

  return CashTransaction;
};
