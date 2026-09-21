module.exports = (sequelize, DataTypes) => {
  const UserSession = sequelize.define("UserSession", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    token: {
      type: DataTypes.STRING(512),
      allowNull: false,
      unique: true,
    },
    refreshToken: {
      type: DataTypes.STRING(512),
      allowNull: true,
      unique: true,
    },
    deviceInfo: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    loginTime: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    lastActivity: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    logoutTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  UserSession.associate = function (models) {
    // UserSession belongs to a user
    UserSession.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
    });
  };

  return UserSession;
};
