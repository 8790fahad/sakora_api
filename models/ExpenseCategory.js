module.exports = (sequelize, DataTypes) => {
  const ExpenseCategory = sequelize.define('ExpenseCategory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '#EF4444'
    },
    icon: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  });

  ExpenseCategory.associate = function(models) {
    // ExpenseCategory belongs to a business
    ExpenseCategory.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // ExpenseCategory has many expenses
    ExpenseCategory.hasMany(models.Expense, {
      foreignKey: 'categoryId',
      as: 'expenses'
    });
  };

  return ExpenseCategory;
};

