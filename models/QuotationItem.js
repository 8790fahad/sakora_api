module.exports = (sequelize, DataTypes) => {
  const QuotationItem = sequelize.define("QuotationItem", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pcs",
    },
    quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      validate: { min: 0.001 },
    },
    unitPrice: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: { min: 0 },
    },
    totalPrice: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: { min: 0 },
    },
  });

  QuotationItem.associate = function (models) {
    QuotationItem.belongsTo(models.Quotation, {
      foreignKey: "quotationId",
      as: "quotation",
    });

    QuotationItem.belongsTo(models.Product, {
      foreignKey: { name: "productId", allowNull: true },
      as: "product",
    });
  };

  return QuotationItem;
};
