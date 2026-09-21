const express = require('express');
const { body } = require('express-validator');
const { validationRules, handleValidationErrors } = require('../utils/validation');
const { errorResponse, successResponse } = require('../utils/helpers');
const { authenticate, authorize } = require('../middleware/auth');
const db = require('../models');

const router = express.Router();

// Get business profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const business = await db.Business.findByPk(req.user.businessId, {
      include: [
        {
          model: db.Branch,
          as: 'branches',
          include: [
            { model: db.User, as: 'users', attributes: ['id', 'firstName', 'lastName', 'email', 'role'] }
          ]
        },
        {
          model: db.User,
          as: 'users',
          attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'status']
        }
      ]
    });

    if (!business) {
      return res.status(404).json(errorResponse('Business not found'));
    }

    res.json(successResponse('Business profile retrieved', { business }));

  } catch (error) {
    console.error('Business profile error:', error);
    res.status(500).json(errorResponse('Failed to get business profile', error.message));
  }
});

// Update business profile
router.put('/profile', [
  authenticate,
  authorize(['owner', 'manager']),
  ...validationRules.businessSetup,
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      name,
      description,
      businessType,
      industry,
      registrationNumber,
      taxNumber,
      currency,
      currencySymbol,
      address,
      city,
      state,
      country,
      phone,
      email,
      website,
      taxEnabled,
      taxRate,
      settings
    } = req.body;

    const business = await db.Business.findByPk(req.user.businessId);
    if (!business) {
      return res.status(404).json(errorResponse('Business not found'));
    }

    await business.update({
      name,
      description,
      businessType,
      industry,
      registrationNumber,
      taxNumber,
      currency,
      currencySymbol,
      address,
      city,
      state,
      country,
      phone,
      email,
      website,
      taxEnabled,
      taxRate,
      settings: {
        ...business.settings,
        ...settings
      }
    });

    res.json(successResponse('Business profile updated', { business }));

  } catch (error) {
    console.error('Business update error:', error);
    res.status(500).json(errorResponse('Failed to update business profile', error.message));
  }
});

// Get all branches
router.get('/branches', authenticate, async (req, res) => {
  try {
    const branches = await db.Branch.findAll({
      where: { businessId: req.user.businessId },
      include: [
        {
          model: db.User,
          as: 'users',
          attributes: ['id', 'firstName', 'lastName', 'email', 'role']
        }
      ],
      order: [['isMainBranch', 'DESC'], ['createdAt', 'ASC']]
    });

    res.json(successResponse('Branches retrieved', { branches }));

  } catch (error) {
    console.error('Branches error:', error);
    res.status(500).json(errorResponse('Failed to get branches', error.message));
  }
});

// Create new branch
router.post('/branches', [
  authenticate,
  authorize(['owner', 'manager']),
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('code').optional().isAlphanumeric(),
  body('phone').optional().isMobilePhone(),
  body('email').optional().isEmail().normalizeEmail(),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      name,
      code,
      address,
      city,
      state,
      phone,
      email,
      openingCash
    } = req.body;

    // Check if code already exists
    if (code) {
      const existingBranch = await db.Branch.findOne({
        where: {
          code,
          businessId: req.user.businessId
        }
      });

      if (existingBranch) {
        return res.status(400).json(errorResponse('Branch code already exists'));
      }
    }

    const branch = await db.Branch.create({
      businessId: req.user.businessId,
      name,
      code: code || null,
      address,
      city,
      state,
      phone,
      email,
      openingCash: openingCash || 0,
      status: 'active'
    });

    // Create opening cash transaction if amount > 0
    if (openingCash && parseFloat(openingCash) > 0) {
      await db.CashTransaction.create({
        businessId: business.id,
        branchId: branch.id,
        type: 'in',
        amount: parseFloat(openingCash),
        description: 'Opening balance',
        referenceType: 'opening_balance',
        paymentMethod: 'cash',
        runningBalance: parseFloat(openingCash),
        createdBy: req.user.id
      });
    }

    res.status(201).json(successResponse('Branch created successfully', { branch }));

  } catch (error) {
    console.error('Branch creation error:', error);
    res.status(500).json(errorResponse('Failed to create branch', error.message));
  }
});

// Update branch
router.put('/branches/:id', [
  authenticate,
  authorize(['owner', 'manager']),
  ...validationRules.uuidParam('id'),
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('phone').optional().isMobilePhone(),
  body('email').optional().isEmail().normalizeEmail(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      code,
      address,
      city,
      state,
      phone,
      email,
      status
    } = req.body;

    const branch = await db.Branch.findOne({
      where: {
        id,
        businessId: req.user.businessId
      }
    });

    if (!branch) {
      return res.status(404).json(errorResponse('Branch not found'));
    }

    // Check if code already exists (excluding current branch)
    if (code && code !== branch.code) {
      const existingBranch = await db.Branch.findOne({
        where: {
          code,
          businessId: req.user.businessId,
          id: { [db.Sequelize.Op.ne]: id }
        }
      });

      if (existingBranch) {
        return res.status(400).json(errorResponse('Branch code already exists'));
      }
    }

    await branch.update({
      name,
      code,
      address,
      city,
      state,
      phone,
      email,
      status
    });

    res.json(successResponse('Branch updated successfully', { branch }));

  } catch (error) {
    console.error('Branch update error:', error);
    res.status(500).json(errorResponse('Failed to update branch', error.message));
  }
});

// Delete branch
router.delete('/branches/:id', [
  authenticate,
  authorize(['owner']),
  ...validationRules.uuidParam('id'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { id } = req.params;

    const branch = await db.Branch.findOne({
      where: {
        id,
        businessId: req.user.businessId
      }
    });

    if (!branch) {
      return res.status(404).json(errorResponse('Branch not found'));
    }

    // Prevent deletion of main branch
    if (branch.isMainBranch) {
      return res.status(400).json(errorResponse('Cannot delete main branch'));
    }

    // Check if branch has users
    const userCount = await db.User.count({
      where: { branchId: id }
    });

    if (userCount > 0) {
      return res.status(400).json(errorResponse('Cannot delete branch with active users'));
    }

    // Check if branch has transactions
    const saleCount = await db.Sale.count({
      where: { branchId: id }
    });

    const purchaseCount = await db.Purchase.count({
      where: { branchId: id }
    });

    if (saleCount > 0 || purchaseCount > 0) {
      return res.status(400).json(errorResponse('Cannot delete branch with transaction history'));
    }

    await branch.destroy();

    res.json(successResponse('Branch deleted successfully'));

  } catch (error) {
    console.error('Branch deletion error:', error);
    res.status(500).json(errorResponse('Failed to delete branch', error.message));
  }
});

// Get business statistics
router.get('/stats', authenticate, async (req, res) => {
  try {
    const businessId = req.user.businessId;

    // Get basic counts
    const [
      totalProducts,
      totalCustomers,
      totalSuppliers,
      totalUsers,
      totalBranches
    ] = await Promise.all([
      db.Product.count({ where: { businessId } }),
      db.Customer.count({ where: { businessId } }),
      db.Supplier.count({ where: { businessId } }),
      db.User.count({ where: { businessId } }),
      db.Branch.count({ where: { businessId } })
    ]);

    // Get sales summary (current month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlySales = await db.Sale.findAll({
      include: [{
        model: db.Branch,
        as: 'branch',
        where: { businessId }
      }],
      where: {
        date: { [db.Sequelize.Op.gte]: startOfMonth },
        status: 'completed'
      },
      attributes: [
        [db.sequelize.fn('SUM', db.sequelize.col('total')), 'totalSales'],
        [db.sequelize.fn('COUNT', db.sequelize.col('Sale.id')), 'totalTransactions']
      ],
      raw: true
    });

    const stats = {
      inventory: {
        totalProducts,
        lowStockItems: 0 // TODO: Calculate from inventory
      },
      customers: {
        totalCustomers
      },
      suppliers: {
        totalSuppliers
      },
      users: {
        totalUsers
      },
      branches: {
        totalBranches
      },
      sales: {
        monthlyTotal: parseFloat(monthlySales[0]?.totalSales || 0),
        monthlyTransactions: parseInt(monthlySales[0]?.totalTransactions || 0)
      }
    };

    res.json(successResponse('Business statistics retrieved', { stats }));

  } catch (error) {
    console.error('Business stats error:', error);
    res.status(500).json(errorResponse('Failed to get business statistics', error.message));
  }
});

module.exports = router;
