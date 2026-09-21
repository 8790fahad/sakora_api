module.exports = (sequelize, DataTypes) => {
  const Expense = sequelize.define('Expense', {
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
    expenseNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
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
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    paymentMethod: {
      type: DataTypes.ENUM('cash', 'bank', 'card', 'cheque', 'mobile', 'other'),
      defaultValue: 'cash'
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true
    },
    receiptImage: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('paid', 'pending', 'cancelled'),
      defaultValue: 'paid'
    },
    isRecurring: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    recurringFrequency: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly'),
      allowNull: true
    },
    nextDueDate: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    tags: {
      type: DataTypes.JSON,
      defaultValue: []
    }
  });

  Expense.associate = function(models) {
    // Expense belongs to a business
    Expense.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // Expense belongs to a branch
    Expense.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      as: 'branch'
    });

    // Expense belongs to a category
    Expense.belongsTo(models.ExpenseCategory, {
      foreignKey: 'categoryId',
      as: 'category'
    });

    // Expense created by user
    Expense.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });

    // Expense has many cash transactions
    Expense.hasMany(models.CashTransaction, {
      foreignKey: 'referenceId',
      as: 'transactions',
      scope: {
        referenceType: 'expense'
      }
    });
  };

  return Expense;
};
