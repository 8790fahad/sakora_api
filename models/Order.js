module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define("Order", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    branchId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    orderNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    source: {
      type: DataTypes.ENUM("storefront", "pos"),
      defaultValue: "storefront",
    },
    status: {
      type: DataTypes.ENUM(
        "pending",
        "paid",
        "processing",
        "packed",
        "shipped",
        "delivered",
        "cancelled",
        "refunded"
      ),
      defaultValue: "pending",
    },
    paymentStatus: {
      type: DataTypes.ENUM("pending", "paid", "failed", "refunded"),
      defaultValue: "pending",
    },
    paymentMethod: {
      type: DataTypes.STRING,
      defaultValue: "squad",
    },
    paymentReference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    customerPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    shippingAddress: {
      type: DataTypes.JSON,
      defaultValue: {},
      get() {
        const raw = this.getDataValue("shippingAddress");
        if (!raw) return {};
        if (typeof raw === "object") return raw;
        try {
          return JSON.parse(raw);
        } catch (error) {
          return {};
        }
      },
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    subtotal: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    taxAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    discountAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    shippingAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    total: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    paidAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.0,
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    fulfilledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  Order.associate = function (models) {
    Order.belongsTo(models.Business, {
      foreignKey: "businessId",
      as: "business",
    });
    Order.belongsTo(models.Branch, {
      foreignKey: "branchId",
      as: "branch",
    });
    Order.belongsTo(models.Customer, {
      foreignKey: "customerId",
      as: "customer",
    });
    Order.hasMany(models.OrderItem, {
      foreignKey: "orderId",
      as: "items",
    });
    Order.hasMany(models.Payment, {
      foreignKey: "referenceId",
      constraints: false,
      as: "payments",
    });
  };

  return Order;
};
