module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define('Category', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '#3B82F6'
    },
    icon: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  });

  Category.associate = function(models) {
    // Category belongs to a business
    Category.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // Category can have a parent category
    Category.belongsTo(models.Category, {
      foreignKey: 'parentId',
      as: 'parent'
    });

    // Category has many child categories
    Category.hasMany(models.Category, {
      foreignKey: 'parentId',
      as: 'children'
    });

    // Category has many products
    Category.hasMany(models.Product, {
      foreignKey: 'categoryId',
      as: 'products'
    });
  };

  return Category;
};

