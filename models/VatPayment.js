module.exports = (sequelize, DataTypes) => {
  const VatPayment = sequelize.define("VatPayment", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: { min: 0.01 },
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    paymentMethod: {
      type: DataTypes.STRING,
      defaultValue: "bank",
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  VatPayment.associate = function (models) {
    VatPayment.belongsTo(models.Business, {
      foreignKey: "businessId",
      as: "business",
    });
    VatPayment.belongsTo(models.User, {
      foreignKey: "createdBy",
      as: "creator",
    });
  };

  return VatPayment;
};
