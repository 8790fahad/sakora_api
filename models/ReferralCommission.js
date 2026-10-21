module.exports = (sequelize, DataTypes) => {
  const ReferralCommission = sequelize.define("ReferralCommission", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    referrerBusinessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    referredBusinessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    subscriptionId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    paymentId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },
    rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 20,
    },
    currency: {
      type: DataTypes.STRING,
      defaultValue: "NGN",
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "paid", "cancelled"),
      defaultValue: "approved",
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
  });

  ReferralCommission.associate = function (models) {
    ReferralCommission.belongsTo(models.Business, {
      foreignKey: "referrerBusinessId",
      as: "referrer",
    });
    ReferralCommission.belongsTo(models.Business, {
      foreignKey: "referredBusinessId",
      as: "referred",
    });
    ReferralCommission.belongsTo(models.Subscription, {
      foreignKey: "subscriptionId",
      as: "subscription",
    });
    ReferralCommission.belongsTo(models.Payment, {
      foreignKey: "paymentId",
      as: "payment",
    });
  };

  return ReferralCommission;
};
