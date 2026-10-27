// Codes live in BILLING_COUPONS as CODE:percent. 100 skips Squad.
const loadCoupons = () => {
  const coupons = new Map();
  const raw = process.env.BILLING_COUPONS || "";
  for (const part of raw.split(",")) {
    const [code, percentText] = part.split(":").map((value) => value.trim());
    const percent = Number(percentText);
    if (!code || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
      continue;
    }
    coupons.set(code.toUpperCase(), percent);
  }
  return coupons;
};

const lookupCoupon = (code) => {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return null;
  const percent = loadCoupons().get(key);
  if (!percent) return null;
  return { code: key, percent };
};

const priceAfterCoupon = (listPrice, coupon) => {
  const price = Math.round(Number(listPrice) || 0);
  if (!coupon) return { amount: price, discount: 0 };
  const discount = Math.round((price * coupon.percent) / 100);
  return {
    amount: Math.max(0, price - discount),
    discount,
    code: coupon.code,
    percent: coupon.percent,
  };
};

module.exports = { lookupCoupon, priceAfterCoupon };
