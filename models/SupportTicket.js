module.exports = (sequelize, DataTypes) => {
  const SupportTicket = sequelize.define("SupportTicket", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    subject: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("open", "closed"),
      allowNull: false,
      defaultValue: "open",
    },
  });

  SupportTicket.associate = (models) => {
    SupportTicket.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    SupportTicket.hasMany(models.SupportMessage, {
      foreignKey: "ticketId",
      as: "messages",
    });
  };

  return SupportTicket;
};
