module.exports = (sequelize, DataTypes) => {
  const Quotation = sequelize.define(
    "Quotation",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      businessId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "business_id",
      },
      quotationNumber: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      customerName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      customerPhone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customerEmail: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      subtotal: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
        validate: { min: 0 },
      },
      taxAmount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
        validate: { min: 0 },
      },
      total: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
        validate: { min: 0 },
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("open", "cancelled"),
        allowNull: false,
        defaultValue: "open",
      },
      inventoryReduced: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["business_id", "quotation_number"],
          name: "quotations_business_number_unique",
        },
      ],
    }
  );

  Quotation.associate = function (models) {
    Quotation.belongsTo(models.Business, {
      foreignKey: "businessId",
      as: "business",
    });

    Quotation.belongsTo(models.Branch, {
      foreignKey: { name: "branchId", allowNull: false },
      as: "branch",
    });

    Quotation.belongsTo(models.Customer, {
      foreignKey: { name: "customerId", allowNull: true },
      as: "customer",
    });

    Quotation.belongsTo(models.User, {
      foreignKey: { name: "createdBy", allowNull: false },
      as: "creator",
    });

    Quotation.hasMany(models.QuotationItem, {
      foreignKey: "quotationId",
      as: "items",
    });
  };

  return Quotation;
};
