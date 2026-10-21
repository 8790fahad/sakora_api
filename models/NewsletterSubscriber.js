module.exports = (sequelize, DataTypes) => {
  const NewsletterSubscriber = sequelize.define("NewsletterSubscriber", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(180),
      allowNull: false,
      unique: true,
    },
    source: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "website",
    },
  });

  return NewsletterSubscriber;
};
