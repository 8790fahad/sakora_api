const db = require("../models");

class TenantError extends Error {
  constructor(message, statusCode = 404) {
    super(message);
    this.name = "TenantError";
    this.statusCode = statusCode;
  }
}

const pickAllowed = (obj, keys) => {
  const out = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
};

const tenantWhere = (req, extra = {}) => ({
  businessId: req.user.businessId,
  ...extra,
});

const branchTenantWhere = (req, extra = {}) => ({
  businessId: req.user.businessId,
  branchId: req.user.branchId,
  ...extra,
});

async function findForBusiness(Model, id, businessId, options = {}) {
  if (!id || !businessId) return null;
  return Model.findOne({
    where: { id, businessId },
    ...options,
  });
}

async function assertForBusiness(Model, id, businessId, label = "Resource") {
  const row = await findForBusiness(Model, id, businessId);
  if (!row) {
    throw new TenantError(`${label} not found`);
  }
  return row;
}

async function assertBranchInBusiness(branchId, businessId, { requireActive = false } = {}) {
  if (!branchId) {
    throw new TenantError("Branch is required", 400);
  }
  const where = { id: branchId, businessId };
  if (requireActive) where.status = "active";
  const branch = await db.Branch.findOne({ where });
  if (!branch) {
    throw new TenantError("Invalid branch for this business", 400);
  }
  return branch;
}

async function assertProductsInBusiness(productIds, businessId, options = {}) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) {
    throw new TenantError("At least one product is required", 400);
  }

  const products = await db.Product.findAll({
    where: {
      id: ids,
      businessId,
      ...(options.status ? { status: options.status } : {}),
    },
    include: options.include || [],
  });

  if (products.length !== ids.length) {
    throw new TenantError("One or more products not found", 400);
  }

  return products;
}

async function ensureUserBranchBelongsToBusiness(user) {
  if (!user?.businessId || !user?.branchId) return user;

  const branch = user.branch;
  if (branch && branch.businessId && branch.businessId !== user.businessId) {
    throw new TenantError("Account branch does not belong to this business", 403);
  }

  if (!branch || !branch.businessId) {
    await assertBranchInBusiness(user.branchId, user.businessId);
  }

  return user;
}

function handleTenantError(res, error, fallbackMessage = "Request failed") {
  if (error instanceof TenantError || error?.name === "TenantError") {
    return res
      .status(error.statusCode || 404)
      .json({ success: false, message: error.message });
  }
  return null;
}

module.exports = {
  TenantError,
  pickAllowed,
  tenantWhere,
  branchTenantWhere,
  findForBusiness,
  assertForBusiness,
  assertBranchInBusiness,
  assertProductsInBusiness,
  ensureUserBranchBelongsToBusiness,
  handleTenantError,
};
