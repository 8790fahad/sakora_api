module.exports = (sequelize, DataTypes) => {
  const SupportMessage = sequelize.define("SupportMessage", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ticketId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    author: {
      type: DataTypes.ENUM("merchant", "support"),
      allowNull: false,
      defaultValue: "merchant",
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  });

  SupportMessage.associate = (models) => {
    SupportMessage.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    SupportMessage.belongsTo(models.SupportTicket, {
      foreignKey: "ticketId",
      as: "ticket",
    });
  };

  return SupportMessage;
};
