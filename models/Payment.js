module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define("Payment", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    referenceType: {
      type: DataTypes.ENUM("order", "subscription"),
      allowNull: false,
    },
    referenceId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    provider: {
      type: DataTypes.STRING,
      defaultValue: "squad",
    },
    providerReference: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING,
      defaultValue: "NGN",
    },
    status: {
      type: DataTypes.ENUM("pending", "success", "failed", "refunded"),
      defaultValue: "pending",
    },
    checkoutUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  Payment.associate = function (models) {
    Payment.belongsTo(models.Business, {
      foreignKey: "businessId",
      as: "business",
    });
  };

  return Payment;
};
