module.exports = (sequelize, DataTypes) => {
  const Subscription = sequelize.define("Subscription", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    plan: {
      type: DataTypes.ENUM("free", "basic", "premium"),
      defaultValue: "free",
    },
    status: {
      type: DataTypes.ENUM("active", "past_due", "cancelled", "pending"),
      defaultValue: "pending",
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    currency: {
      type: DataTypes.STRING,
      defaultValue: "NGN",
    },
    paymentReference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    currentPeriodStart: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    currentPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
  });

  Subscription.associate = function (models) {
    Subscription.belongsTo(models.Business, {
      foreignKey: "businessId",
      as: "business",
    });
  };

  return Subscription;
};
