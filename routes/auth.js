const express = require('express');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const { body } = require('express-validator');
const { validationRules, handleValidationErrors } = require('../utils/validation');
const { errorResponse, successResponse } = require('../utils/helpers');
const { authenticate } = require('../middleware/auth');
const { serializeUser } = require('../utils/permissions');
const { uniqueSlug } = require('../utils/slug');
const db = require('../models');

const router = express.Router();

// JWT Secret - use environment variable or fallback for development
const JWT_SECRET = process.env.JWT_SECRET || 'sakora-dev-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Register new user and business
router.post('/register', [
  ...validationRules.userRegistration,
  handleValidationErrors
], async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      businessName,
      businessType,
      marketingOptIn,
    } = req.body;

    // Check if user already exists
    const existingUser = await db.User.findOne({
      where: { email },
      paranoid: false // Include soft-deleted users
    });

    if (existingUser) {
      await transaction.rollback();
      return res.status(400).json(errorResponse('User already exists with this email'));
    }

    // Create business first
    const businessNameValue = businessName || `${firstName}'s Business`;
    const business = await db.Business.create({
      name: businessNameValue,
      businessType: businessType || 'retail',
      currency: 'NGN',
      currencySymbol: '₦',
      storefrontSlug: await uniqueSlug(db, businessNameValue),
      storefrontEnabled: true
    }, { transaction });

    // Create main branch
    const branch = await db.Branch.create({
      businessId: business.id,
      name: 'Main Branch',
      isMainBranch: true,
      status: 'active'
    }, { transaction });

    // Create user
    const user = await db.User.create({
      email,
      phone,
      password,
      firstName,
      lastName,
      role: 'owner',
      businessId: business.id,
      branchId: branch.id,
      status: 'active',
      preferences: {
        acceptedTerms: true,
        acceptedTermsAt: new Date().toISOString(),
        termsVersion: '1.0',
        marketingOptIn: marketingOptIn === true || marketingOptIn === 'true',
      },
    }, { transaction });

    // Create default expense categories
    const defaultExpenseCategories = [
      { name: 'Rent', color: '#EF4444', icon: 'home', isDefault: true },
      { name: 'Utilities', color: '#F59E0B', icon: 'zap', isDefault: true },
      { name: 'Salaries', color: '#10B981', icon: 'users', isDefault: true },
      { name: 'Transport', color: '#3B82F6', icon: 'truck', isDefault: true },
      { name: 'Marketing', color: '#8B5CF6', icon: 'megaphone', isDefault: true },
      { name: 'Office Supplies', color: '#6B7280', icon: 'package', isDefault: true },
      { name: 'Other', color: '#374151', icon: 'more-horizontal', isDefault: true }
    ];

    for (const category of defaultExpenseCategories) {
      await db.ExpenseCategory.create({
        ...category,
        businessId: business.id
      }, { transaction });
    }

    // Create default product categories
    const defaultProductCategories = [
      { name: 'General', color: '#3B82F6', icon: 'package' },
      { name: 'Electronics', color: '#8B5CF6', icon: 'smartphone' },
      { name: 'Clothing', color: '#EC4899', icon: 'shopping-bag' },
      { name: 'Food & Beverages', color: '#10B981', icon: 'coffee' },
      { name: 'Health & Beauty', color: '#F59E0B', icon: 'heart' }
    ];

    for (const category of defaultProductCategories) {
      await db.Category.create({
        ...category,
        businessId: business.id
      }, { transaction });
    }

    await transaction.commit();

    // Get user with associations for response
    const userWithAssociations = await db.User.findByPk(user.id, {
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' }
      ]
    });

    // Generate JWT token
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      businessId: business.id,
      branchId: branch.id
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
    });

    // Create session
    const now = new Date();
    await db.UserSession.create({
      userId: user.id,
      token,
      deviceInfo: {
        userAgent: req.get('User-Agent'),
        platform: req.get('User-Agent')
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      loginTime: now,
      lastActivity: now,
      expiresAt: moment().add(7, 'days').toDate()
    });

    res.status(201).json(successResponse('Registration successful', {
      token,
      user: serializeUser(userWithAssociations)
    }));

  } catch (error) {
    // Only rollback if transaction is not yet committed
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    console.error('Registration error:', error);
    res.status(500).json(errorResponse('Registration failed', error.message));
  }
});

// Login user
router.post('/login', [
  ...validationRules.userLogin,
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user with password
    const user = await db.User.scope('withPassword').findOne({
      where: {
        email,
        status: 'active'
      },
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' }
      ]
    });

    if (!user) {
      return res.status(401).json(errorResponse('Invalid email or password'));
    }

    // Check password
    const isValidPassword = await user.checkPassword(password);
    if (!isValidPassword) {
      return res.status(401).json(errorResponse('Invalid email or password'));
    }

    // Check if business is active
    if (user.business?.status !== 'active') {
      return res.status(403).json(errorResponse('Business account is suspended'));
    }

    // Generate JWT token
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      businessId: user.businessId,
      branchId: user.branchId
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
    });

    // Create session
    const now = new Date();
    await db.UserSession.create({
      userId: user.id,
      token,
      deviceInfo: {
        userAgent: req.get('User-Agent'),
        platform: req.get('User-Agent')
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      loginTime: now,
      lastActivity: now,
      expiresAt: moment().add(7, 'days').toDate()
    });

    // Update last login
    await user.update({ lastLogin: new Date() });

    res.json(successResponse('Login successful', {
      token,
      user: serializeUser(user)
    }));

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json(errorResponse('Login failed', error.message));
  }
});

// Logout user
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Deactivate current session
    await req.session.update({
      isActive: false,
      logoutTime: new Date()
    });

    res.json(successResponse('Logout successful'));

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json(errorResponse('Logout failed', error.message));
  }
});

// Get current user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await db.User.findByPk(req.user.id, {
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' }
      ]
    });

    if (!user) {
      return res.status(404).json(errorResponse('User not found'));
    }

    res.json(successResponse('Profile retrieved', { user: serializeUser(user) }));

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json(errorResponse('Failed to get profile', error.message));
  }
});

// Update user profile
router.put('/profile', [
  authenticate,
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
  body('phone').optional().isMobilePhone(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { firstName, lastName, phone } = req.body;

    const user = await db.User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json(errorResponse('User not found'));
    }

    await user.update({
      firstName,
      lastName,
      phone
    });

    const updatedUser = await db.User.findByPk(user.id, {
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' }
      ]
    });

    res.json(successResponse('Profile updated', { user: updatedUser }));

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json(errorResponse('Failed to update profile', error.message));
  }
});

// Change password
router.put('/change-password', [
  authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  handleValidationErrors
], async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await db.User.scope('withPassword').findByPk(req.user.id);
    if (!user) {
      return res.status(404).json(errorResponse('User not found'));
    }

    // Verify current password
    const isValidPassword = await user.checkPassword(currentPassword);
    if (!isValidPassword) {
      return res.status(400).json(errorResponse('Current password is incorrect'));
    }

    // Update password
    await user.update({ password: newPassword });

    res.json(successResponse('Password changed successfully'));

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json(errorResponse('Failed to change password', error.message));
  }
});

// Get user sessions
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await db.UserSession.findAll({
      where: {
        userId: req.user.id,
        isActive: true
      },
      order: [['lastActivity', 'DESC']],
      attributes: ['id', 'deviceInfo', 'ipAddress', 'loginTime', 'lastActivity']
    });

    res.json(successResponse('Sessions retrieved', { sessions }));

  } catch (error) {
    console.error('Sessions error:', error);
    res.status(500).json(errorResponse('Failed to get sessions', error.message));
  }
});

// Revoke session
router.delete('/sessions/:sessionId', [
  authenticate,
  ...validationRules.uuidParam('sessionId'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await db.UserSession.findOne({
      where: {
        id: sessionId,
        userId: req.user.id
      }
    });

    if (!session) {
      return res.status(404).json(errorResponse('Session not found'));
    }

    await session.update({
      isActive: false,
      logoutTime: new Date()
    });

    res.json(successResponse('Session revoked'));

  } catch (error) {
    console.error('Session revoke error:', error);
    res.status(500).json(errorResponse('Failed to revoke session', error.message));
  }
});

module.exports = router;
