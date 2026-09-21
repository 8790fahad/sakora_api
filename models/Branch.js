module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define("Branch", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 100],
      },
    },
    code: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true,
      },
    },
    isMainBranch: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    status: {
      type: DataTypes.ENUM("active", "inactive"),
      defaultValue: "active",
    },
    openingCash: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    settings: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
  });

  Branch.associate = function (models) {
    // Branch belongs to a business
    Branch.belongsTo(models.Business, {
      foreignKey: "businessId",
      as: "business",
    });

    // Branch has many users
    Branch.hasMany(models.User, {
      foreignKey: "branchId",
      as: "users",
    });

    // Branch has many inventory items
    Branch.hasMany(models.Inventory, {
      foreignKey: "branchId",
      as: "inventory",
    });

    // Branch has many sales
    Branch.hasMany(models.Sale, {
      foreignKey: "branchId",
      as: "sales",
    });

    // Branch has many purchases
    Branch.hasMany(models.Purchase, {
      foreignKey: "branchId",
      as: "purchases",
    });

    // Branch has many expenses
    Branch.hasMany(models.Expense, {
      foreignKey: "branchId",
      as: "expenses",
    });

    // Branch has many cash transactions
    Branch.hasMany(models.CashTransaction, {
      foreignKey: "branchId",
      as: "cashTransactions",
    });
  };

  return Branch;
};

