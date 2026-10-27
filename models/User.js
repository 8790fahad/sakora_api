const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [6, 255]
      }
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    role: {
      type: DataTypes.ENUM('owner', 'manager', 'staff'),
      defaultValue: 'owner'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'pending'),
      defaultValue: 'active'
    },
    avatar: {
      type: DataTypes.STRING,
      allowNull: true
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true
    },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    emailVerificationCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    emailVerificationExpires: {
      type: DataTypes.DATE,
      allowNull: true
    },
    googleId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    passwordResetCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    passwordResetExpires: {
      type: DataTypes.DATE,
      allowNull: true
    },
    phoneVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    permissions: {
      type: DataTypes.JSON,
      allowNull: true
    },
    preferences: {
      type: DataTypes.JSON,
      allowNull: true,
      get() {
        const raw = this.getDataValue('preferences');
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try {
          return JSON.parse(raw);
        } catch (error) {
          return {};
        }
      }
    }
  }, {
    hooks: {
      beforeSave: async (user) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      }
    },
    defaultScope: {
      attributes: {
        exclude: [
          'password',
          'emailVerificationCode',
          'emailVerificationExpires',
          'passwordResetCode',
          'passwordResetExpires',
        ],
      },
    },
    scopes: {
      withPassword: {
        attributes: { include: ['password'] }
      },
      withEmailVerification: {
        attributes: {
          include: ['emailVerificationCode', 'emailVerificationExpires'],
        },
      },
    }
  });

  User.associate = function(models) {
    // User belongs to a business
    User.belongsTo(models.Business, {
      foreignKey: 'businessId',
      as: 'business'
    });

    // User belongs to a branch
    User.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      as: 'branch'
    });

    // User can create multiple sales, purchases, expenses
    User.hasMany(models.Sale, {
      foreignKey: 'createdBy',
      as: 'sales'
    });

    User.hasMany(models.Purchase, {
      foreignKey: 'createdBy',
      as: 'purchases'
    });

    User.hasMany(models.Expense, {
      foreignKey: 'createdBy',
      as: 'expenses'
    });

    // User sessions
    User.hasMany(models.UserSession, {
      foreignKey: 'userId',
      as: 'sessions'
    });

    User.hasMany(models.Notification, {
      foreignKey: 'userId',
      as: 'notifications'
    });
  };

  // Instance method to check password
  User.prototype.checkPassword = async function(password) {
    return await bcrypt.compare(password, this.password);
  };

  // Instance method to get full name
  User.prototype.getFullName = function() {
    return `${this.firstName} ${this.lastName}`;
  };

  return User;
};

