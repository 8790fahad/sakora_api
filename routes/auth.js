const express = require('express');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const { body } = require('express-validator');
const { validationRules, handleValidationErrors } = require('../utils/validation');
const { errorResponse, successResponse } = require('../utils/helpers');
const { authenticate, invalidateSession } = require('../middleware/auth');
const { serializeUser } = require('../utils/permissions');
const { getJwtSecret } = require('../config/secrets');
const {
  issueEmailVerification,
  codesMatch,
} = require('../services/emailVerification');
const {
  issuePasswordReset,
  codesMatch: passwordResetCodesMatch,
} = require('../services/passwordReset');
const {
  isConfigured: isGoogleConfigured,
  verifyGoogleIdToken,
} = require('../services/googleAuth');
const {
  normalizeNamePart,
  provisionOwnerAccount,
} = require('../services/provisionOwner');
const { resolveReferrerBusiness } = require('../utils/referrals');
const db = require('../models');

const router = express.Router();

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const createAuthSession = async (user, req) => {
  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    businessId: user.businessId,
    branchId: user.branchId,
  };

  const token = jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  const now = new Date();
  await db.UserSession.create({
    userId: user.id,
    token,
    deviceInfo: {
      userAgent: req.get('User-Agent'),
      platform: req.get('User-Agent'),
    },
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    loginTime: now,
    lastActivity: now,
    expiresAt: moment().add(7, 'days').toDate(),
  });

  return token;
};

// Register new user and business
router.post('/register', [
  ...validationRules.userRegistration,
  handleValidationErrors
], async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      password,
      firstName,
      lastName,
      phone,
      businessName,
      businessType,
      marketingOptIn,
      referralCode,
    } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();

    // Check if user already exists
    const existingUser = await db.User.findOne({
      where: { email },
      paranoid: false // Include soft-deleted users
    });

    if (existingUser) {
      await transaction.rollback();
      return res.status(400).json(errorResponse('User already exists with this email'));
    }

    let referredByBusinessId = null;
    if (referralCode) {
      const referrer = await resolveReferrerBusiness(referralCode, transaction);
      if (!referrer) {
        await transaction.rollback();
        return res.status(400).json(errorResponse('Invalid referral code'));
      }
      referredByBusinessId = referrer.id;
    }

    const { user } = await provisionOwnerAccount({
      email,
      password,
      firstName,
      lastName,
      phone,
      businessName,
      businessType,
      marketingOptIn,
      emailVerified: false,
      referredByBusinessId,
      transaction,
    });

    await transaction.commit();

    await issueEmailVerification(user);

    res.status(201).json(successResponse('Check your email for a verification code', {
      requiresVerification: true,
      email: user.email,
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

// Google sign-in / sign-up (ID token from Google Identity Services)
router.post('/google', [
  body('idToken').notEmpty().withMessage('Google ID token is required'),
  body('businessName').optional().trim().isLength({ min: 2, max: 100 }),
  body('marketingOptIn').optional(),
  body('referralCode').optional().trim().isLength({ min: 4, max: 16 }),
  handleValidationErrors,
], async (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json(errorResponse('Google sign-in is not configured'));
  }

  const transaction = await db.sequelize.transaction();

  try {
    const profile = await verifyGoogleIdToken(req.body.idToken);
    const firstName = normalizeNamePart(
      profile.firstName || profile.fullName?.split(' ')[0],
      'User'
    );
    const lastName = normalizeNamePart(
      profile.lastName || profile.fullName?.split(' ').slice(1).join(' '),
      firstName
    );

    let user = await db.User.findOne({
      where: { googleId: profile.googleId },
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' },
      ],
      paranoid: false,
    });

    if (!user) {
      user = await db.User.findOne({
        where: { email: profile.email },
        include: [
          { model: db.Business, as: 'business' },
          { model: db.Branch, as: 'branch' },
        ],
        paranoid: false,
      });
    }

    let isNewUser = false;

    if (user) {
      if (user.deletedAt) {
        await transaction.rollback();
        return res.status(400).json(errorResponse('This account is no longer available'));
      }
      if (user.status !== 'active') {
        await transaction.rollback();
        return res.status(403).json(errorResponse('Account is inactive'));
      }
      if (user.business?.status && user.business.status !== 'active') {
        await transaction.rollback();
        return res.status(403).json(errorResponse('Business account is suspended'));
      }

      const updates = {
        emailVerified: true,
        lastLogin: new Date(),
        emailVerificationCode: null,
        emailVerificationExpires: null,
      };
      if (!user.googleId) updates.googleId = profile.googleId;
      if (profile.avatar && !user.avatar) updates.avatar = profile.avatar;
      await user.update(updates, { transaction });
      await transaction.commit();
    } else {
      isNewUser = true;
      let referredByBusinessId = null;
      if (req.body.referralCode) {
        const referrer = await resolveReferrerBusiness(
          req.body.referralCode,
          transaction
        );
        if (!referrer) {
          await transaction.rollback();
          return res.status(400).json(errorResponse('Invalid referral code'));
        }
        referredByBusinessId = referrer.id;
      }
      const provisioned = await provisionOwnerAccount({
        email: profile.email,
        firstName,
        lastName,
        businessName: req.body.businessName || `${firstName}'s Business`,
        marketingOptIn: req.body.marketingOptIn,
        emailVerified: true,
        googleId: profile.googleId,
        avatar: profile.avatar,
        referredByBusinessId,
        transaction,
      });
      user = provisioned.user;
      await transaction.commit();
    }

    const userWithAssociations = await db.User.findByPk(user.id, {
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' },
      ],
    });

    const token = await createAuthSession(userWithAssociations, req);
    await userWithAssociations.update({ lastLogin: new Date() });

    res.status(isNewUser ? 201 : 200).json(
      successResponse(isNewUser ? 'Account created with Google' : 'Signed in with Google', {
        token,
        user: serializeUser(userWithAssociations),
        isNewUser,
      })
    );
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    console.error('Google auth error:', error);
    const message =
      error.message?.includes('configured') ||
      error.message?.includes('email') ||
      error.message?.includes('Token')
        ? error.message
        : 'Google sign-in failed';
    res.status(400).json(errorResponse(message, error.message));
  }
});

// Verify email with 6-digit code, then sign the user in
router.post('/verify-email', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('code')
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage('Enter the 6-digit code from your email'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();

    const user = await db.User.unscoped().findOne({
      where: { email, status: 'active' },
      attributes: {
        exclude: ['password'],
      },
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' },
      ],
    });

    if (!user) {
      return res.status(400).json(errorResponse('Invalid verification code'));
    }

    if (user.emailVerified) {
      const token = await createAuthSession(user, req);
      await user.update({ lastLogin: new Date() });
      return res.json(successResponse('Email already verified', {
        token,
        user: serializeUser(user),
      }));
    }

    if (
      !user.emailVerificationExpires ||
      new Date(user.emailVerificationExpires) < new Date()
    ) {
      return res.status(400).json(errorResponse('Verification code has expired. Request a new one.'));
    }

    if (!codesMatch(code, user.emailVerificationCode)) {
      return res.status(400).json(errorResponse('Invalid verification code'));
    }

    await user.update({
      emailVerified: true,
      emailVerificationCode: null,
      emailVerificationExpires: null,
      lastLogin: new Date(),
    });

    const token = await createAuthSession(user, req);
    const refreshed = await db.User.findByPk(user.id, {
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' },
      ],
    });

    res.json(successResponse('Email verified successfully', {
      token,
      user: serializeUser(refreshed),
    }));
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json(errorResponse('Email verification failed', error.message));
  }
});

// Resend verification code
router.post('/resend-verification', [
  body('email').isEmail().withMessage('Valid email is required'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await db.User.findOne({
      where: { email, status: 'active' },
    });

    // Avoid account enumeration
    if (!user) {
      return res.json(successResponse('If an account exists, a new code has been sent'));
    }

    if (user.emailVerified) {
      return res.json(successResponse('Email is already verified. You can sign in.'));
    }

    await issueEmailVerification(user);
    res.json(successResponse('A new verification code has been sent'));
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json(errorResponse('Failed to resend verification code', error.message));
  }
});

// Request password reset code
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await db.User.findOne({
      where: { email, status: 'active' },
    });

    // Always return the same message to avoid account enumeration
    if (user) {
      await issuePasswordReset(user);
    }

    res.json(
      successResponse(
        'If an account exists for that email, a reset code has been sent'
      )
    );
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json(errorResponse('Failed to start password reset', error.message));
  }
});

// Reset password with email code
router.post('/reset-password', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('code')
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage('Enter the 6-digit code from your email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const password = req.body.password;

    const user = await db.User.unscoped().findOne({
      where: { email, status: 'active' },
      attributes: {
        exclude: ['password'],
      },
    });

    if (
      !user ||
      !user.passwordResetExpires ||
      new Date(user.passwordResetExpires) < new Date() ||
      !passwordResetCodesMatch(code, user.passwordResetCode)
    ) {
      return res.status(400).json(errorResponse('Invalid or expired reset code'));
    }

    await user.update({
      password,
      passwordResetCode: null,
      passwordResetExpires: null,
      emailVerified: true,
    });

    // Invalidate existing sessions after a password change
    await db.UserSession.update(
      { isActive: false, logoutTime: new Date() },
      { where: { userId: user.id, isActive: true } }
    );

    res.json(successResponse('Password updated. You can sign in now.'));
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json(errorResponse('Failed to reset password', error.message));
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

    if (!user.emailVerified) {
      await issueEmailVerification(user);
      return res.status(403).json(
        errorResponse('Please verify your email before signing in', {
          requiresVerification: true,
          email: user.email,
        })
      );
    }

    const token = await createAuthSession(user, req);

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
    invalidateSession(req.session.token);

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

    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (phone !== undefined) updates.phone = phone;

    await user.update(updates);

    const updatedUser = await db.User.findByPk(user.id, {
      include: [
        { model: db.Business, as: 'business' },
        { model: db.Branch, as: 'branch' }
      ]
    });

    res.json(successResponse('Profile updated', { user: serializeUser(updatedUser) }));

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
    invalidateSession(session.token);

    res.json(successResponse('Session revoked'));

  } catch (error) {
    console.error('Session revoke error:', error);
    res.status(500).json(errorResponse('Failed to revoke session', error.message));
  }
});

module.exports = router;
