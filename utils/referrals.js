const crypto = require("crypto");
const db = require("../models");

const REFERRAL_COMMISSION_RATE = Math.min(
  100,
  Math.max(0, Number(process.env.REFERRAL_COMMISSION_RATE || 20))
);

const normalizeReferralCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);

const generateReferralCode = async (transaction) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const existing = await db.Business.findOne({
      where: { referralCode: code },
      transaction,
      paranoid: false,
    });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique referral code");
};

const resolveReferrerBusiness = async (referralCode, transaction) => {
  const code = normalizeReferralCode(referralCode);
  if (!code) return null;

  const referrer = await db.Business.findOne({
    where: { referralCode: code, status: "active" },
    transaction,
  });
  return referrer || null;
};

const awardReferralCommission = async ({
  business,
  subscription,
  payment,
  transaction,
}) => {
  if (!business?.referredByBusinessId) return null;
  if (!payment?.id || !subscription?.id) return null;

  const amountPaid = Number(payment.amount || subscription.amount || 0);
  if (amountPaid <= 0 || REFERRAL_COMMISSION_RATE <= 0) return null;

  const existing = await db.ReferralCommission.findOne({
    where: { paymentId: payment.id },
    transaction,
    paranoid: false,
  });
  if (existing) return existing;

  const commissionAmount =
    Math.round(((amountPaid * REFERRAL_COMMISSION_RATE) / 100) * 100) / 100;
  if (commissionAmount <= 0) return null;

  return db.ReferralCommission.create(
    {
      referrerBusinessId: business.referredByBusinessId,
      referredBusinessId: business.id,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      amount: commissionAmount,
      rate: REFERRAL_COMMISSION_RATE,
      currency: payment.currency || subscription.currency || "NGN",
      status: "approved",
      metadata: {
        plan: subscription.plan,
        interval:
          subscription.metadata?.interval || payment.metadata?.interval || "month",
        months: subscription.metadata?.months || payment.metadata?.months || null,
        paymentAmount: amountPaid,
      },
    },
    { transaction }
  );
};

module.exports = {
  REFERRAL_COMMISSION_RATE,
  normalizeReferralCode,
  generateReferralCode,
  resolveReferrerBusiness,
  awardReferralCommission,
};
