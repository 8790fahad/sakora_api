const { body, param, query, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Common validation rules
const validationRules = {
  // User registration
  userRegistration: [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
    body('firstName')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters'),
    body('lastName')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Last name must be between 2 and 50 characters'),
    body('phone')
      .optional()
      .isMobilePhone()
      .withMessage('Please provide a valid phone number')
  ],

  // User login
  userLogin: [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ],

  // Business setup
  businessSetup: [
    body('name')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Business name must be between 2 and 100 characters'),
    body('businessType')
      .optional()
      .isIn(['retail', 'wholesale', 'manufacturing', 'restaurant', 'pharmacy', 'supermarket', 'fashion', 'electronics', 'other'])
      .withMessage('Invalid business type'),
    body('currency')
      .optional()
      .isLength({ min: 3, max: 3 })
      .withMessage('Currency must be 3 characters (e.g., NGN, USD)'),
    body('phone')
      .optional()
      .isMobilePhone()
      .withMessage('Please provide a valid phone number'),
    body('email')
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address')
  ],

  // Product creation
  productCreation: [
    body('name')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Product name must be between 2 and 100 characters'),
    body('costPrice')
      .isFloat({ min: 0 })
      .withMessage('Cost price must be a positive number'),
    body('sellingPrice')
      .isFloat({ min: 0 })
      .withMessage('Selling price must be a positive number'),
    body('unit')
      .optional()
      .isIn(['piece', 'kg', 'g', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'dozen', 'other'])
      .withMessage('Invalid unit type'),
    body('lowStockThreshold')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Low stock threshold must be a non-negative integer')
  ],

  // Sale creation
  saleCreation: [
    body('items')
      .isArray({ min: 1 })
      .withMessage('At least one item is required'),
    body('items.*.productId')
      .isUUID()
      .withMessage('Product ID must be a valid UUID'),
    body('items.*.quantity')
      .isFloat({ min: 0.001 })
      .withMessage('Quantity must be greater than 0'),
    body('items.*.unitPrice')
      .isFloat({ min: 0 })
      .withMessage('Unit price must be a positive number'),
    body('paymentMethod')
      .optional()
      .isIn(['cash', 'card', 'bank', 'credit', 'mobile', 'other'])
      .withMessage('Invalid payment method'),
    body('paidAmount')
      .isFloat({ min: 0 })
      .withMessage('Paid amount must be a positive number')
  ],

  // Purchase creation
  purchaseCreation: [
    body('items')
      .isArray({ min: 1 })
      .withMessage('At least one item is required'),
    body('items.*.productId')
      .isUUID()
      .withMessage('Product ID must be a valid UUID'),
    body('items.*.quantity')
      .isFloat({ min: 0.001 })
      .withMessage('Quantity must be greater than 0'),
    body('items.*.unitCost')
      .isFloat({ min: 0 })
      .withMessage('Unit cost must be a positive number'),
    body('supplierId')
      .optional()
      .isUUID()
      .withMessage('Supplier ID must be a valid UUID'),
    body('paymentMethod')
      .optional()
      .isIn(['cash', 'bank', 'credit', 'cheque', 'mobile', 'other'])
      .withMessage('Invalid payment method')
  ],

  // Expense creation
  expenseCreation: [
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Amount must be greater than 0'),
    body('description')
      .trim()
      .isLength({ min: 2, max: 200 })
      .withMessage('Description must be between 2 and 200 characters'),
    body('categoryId')
      .isUUID()
      .withMessage('Category ID must be a valid UUID'),
    body('paymentMethod')
      .optional()
      .isIn(['cash', 'bank', 'card', 'cheque', 'mobile', 'other'])
      .withMessage('Invalid payment method')
  ],

  // UUID parameter validation
  uuidParam: (paramName = 'id') => [
    param(paramName)
      .isUUID()
      .withMessage(`${paramName} must be a valid UUID`)
  ],

  // Date range validation
  dateRange: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid date')
  ],

  // Pagination validation
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
  ]
};

module.exports = {
  handleValidationErrors,
  validationRules
};
