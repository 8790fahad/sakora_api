const crypto = require("crypto");
const { uniqueSlug } = require("../utils/slug");
const { generateReferralCode } = require("../utils/referrals");
const db = require("../models");

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Rent", color: "#EF4444", icon: "home", isDefault: true },
  { name: "Utilities", color: "#F59E0B", icon: "zap", isDefault: true },
  { name: "Salaries", color: "#10B981", icon: "users", isDefault: true },
  { name: "Transport", color: "#3B82F6", icon: "truck", isDefault: true },
  { name: "Marketing", color: "#8B5CF6", icon: "megaphone", isDefault: true },
  { name: "Office Supplies", color: "#6B7280", icon: "package", isDefault: true },
  { name: "Other", color: "#374151", icon: "more-horizontal", isDefault: true },
];

const DEFAULT_PRODUCT_CATEGORIES = [
  { name: "General", color: "#3B82F6", icon: "package" },
  { name: "Electronics", color: "#8B5CF6", icon: "smartphone" },
  { name: "Clothing", color: "#EC4899", icon: "shopping-bag" },
  { name: "Food & Beverages", color: "#10B981", icon: "coffee" },
  { name: "Health & Beauty", color: "#F59E0B", icon: "heart" },
];

const normalizeNamePart = (value, fallback) => {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (cleaned.length >= 2) return cleaned.slice(0, 50);
  if (fallback && String(fallback).trim().length >= 2) {
    return String(fallback).trim().slice(0, 50);
  }
  return "User";
};

const createDefaultCategories = async (businessId, transaction) => {
  for (const category of DEFAULT_EXPENSE_CATEGORIES) {
    await db.ExpenseCategory.create(
      { ...category, businessId },
      { transaction }
    );
  }
  for (const category of DEFAULT_PRODUCT_CATEGORIES) {
    await db.Category.create({ ...category, businessId }, { transaction });
  }
};

const collectPhones = (phones, primary) => {
  const list = [];
  const push = (value) => {
    const phone = String(value || "").trim();
    if (phone && !list.includes(phone) && list.length < 30) list.push(phone);
  };
  if (Array.isArray(phones)) phones.forEach(push);
  push(primary);
  return list;
};

const provisionOwnerAccount = async ({
  email,
  password,
  firstName,
  lastName,
  phone = null,
  phones = null,
  description = null,
  registrationNumber = null,
  logo = null,
  businessName,
  businessType = "retail",
  marketingOptIn = false,
  emailVerified = false,
  googleId = null,
  avatar = null,
  referredByBusinessId = null,
  transaction,
}) => {
  const businessNameValue = businessName || `${firstName}'s Business`;
  const phoneList = collectPhones(phones, phone);
  const businessNumber = String(registrationNumber || "").trim().slice(0, 50);
  const business = await db.Business.create(
    {
      name: businessNameValue,
      businessType: businessType || "retail",
      email: email || null,
      description: String(description || "").trim().slice(0, 1000) || null,
      registrationNumber: businessNumber || null,
      phone: phoneList[0] || null,
      logo: logo || null,
      currency: "NGN",
      currencySymbol: "₦",
      storefrontSlug: await uniqueSlug(db, businessNameValue),
      storefrontEnabled: false,
      referralCode: await generateReferralCode(transaction),
      referredByBusinessId: referredByBusinessId || null,
    },
    { transaction }
  );

  const current =
    business.settings && typeof business.settings === "object"
      ? business.settings
      : {};
  await business.update(
    {
      settings: {
        ...current,
        ...(phoneList.length ? { phones: phoneList } : {}),
        needsProfileDetails: true,
      },
    },
    { transaction }
  );

  const branch = await db.Branch.create(
    {
      businessId: business.id,
      name: "Main Branch",
      isMainBranch: true,
      status: "active",
    },
    { transaction }
  );

  const user = await db.User.create(
    {
      email,
      phone,
      password: password || crypto.randomBytes(32).toString("hex"),
      firstName,
      lastName,
      role: "owner",
      businessId: business.id,
      branchId: branch.id,
      status: "active",
      emailVerified: Boolean(emailVerified),
      googleId: googleId || null,
      avatar: avatar || null,
      preferences: {
        acceptedTerms: true,
        acceptedTermsAt: new Date().toISOString(),
        termsVersion: "1.0",
        marketingOptIn: marketingOptIn === true || marketingOptIn === "true",
        authProvider: googleId ? "google" : "password",
      },
    },
    { transaction }
  );

  await createDefaultCategories(business.id, transaction);

  return { user, business, branch };
};

module.exports = {
  normalizeNamePart,
  provisionOwnerAccount,
};
