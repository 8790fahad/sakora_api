const { Sequelize } = require('sequelize');
const config = require('../config/database')[process.env.NODE_ENV || 'development'];

// Initialize Sequelize
const sequelize = new Sequelize(config.database, config.username, config.password, config);

const db = {};

// Import all models
db.User = require('./User')(sequelize, Sequelize.DataTypes);
db.Business = require('./Business')(sequelize, Sequelize.DataTypes);
db.Branch = require('./Branch')(sequelize, Sequelize.DataTypes);
db.Product = require('./Product')(sequelize, Sequelize.DataTypes);
db.Category = require('./Category')(sequelize, Sequelize.DataTypes);
db.Inventory = require('./Inventory')(sequelize, Sequelize.DataTypes);
db.Purchase = require('./Purchase')(sequelize, Sequelize.DataTypes);
db.PurchaseItem = require('./PurchaseItem')(sequelize, Sequelize.DataTypes);
db.Sale = require('./Sale')(sequelize, Sequelize.DataTypes);
db.SaleItem = require('./SaleItem')(sequelize, Sequelize.DataTypes);
db.Expense = require('./Expense')(sequelize, Sequelize.DataTypes);
db.ExpenseCategory = require('./ExpenseCategory')(sequelize, Sequelize.DataTypes);
db.Customer = require('./Customer')(sequelize, Sequelize.DataTypes);
db.Supplier = require('./Supplier')(sequelize, Sequelize.DataTypes);
db.CashTransaction = require('./CashTransaction')(sequelize, Sequelize.DataTypes);
db.UserSession = require('./UserSession')(sequelize, Sequelize.DataTypes);
db.Order = require('./Order')(sequelize, Sequelize.DataTypes);
db.OrderItem = require('./OrderItem')(sequelize, Sequelize.DataTypes);
db.Payment = require('./Payment')(sequelize, Sequelize.DataTypes);
db.Subscription = require('./Subscription')(sequelize, Sequelize.DataTypes);
db.Notification = require('./Notification')(sequelize, Sequelize.DataTypes);
db.MessageLog = require('./MessageLog')(sequelize, Sequelize.DataTypes);
db.VatPayment = require('./VatPayment')(sequelize, Sequelize.DataTypes);
db.NewsletterSubscriber = require('./NewsletterSubscriber')(sequelize, Sequelize.DataTypes);
db.SupportTicket = require('./SupportTicket')(sequelize, Sequelize.DataTypes);
db.SupportMessage = require('./SupportMessage')(sequelize, Sequelize.DataTypes);
db.ReferralCommission = require('./ReferralCommission')(sequelize, Sequelize.DataTypes);

// Define associations
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;

