const PLANS = {
  starter: {
    key: "starter",
    name: "Starter",
    price: 4000,
    yearlyPrice: 40000,
    period: "month",
    description: "A single shop, sales, and stock.",
    features: [
      "1 shop and 1 user",
      "Products and low-stock alerts",
      "Cash and transfer sales",
      "Customers and quotations",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    price: 12000,
    yearlyPrice: 120000,
    period: "month",
    popular: true,
    description: "Online shop, invoices, and a small team.",
    features: [
      "Everything in Starter",
      "Public storefront and invoices",
      "Squad checkout",
      "WhatsApp sharing",
      "Up to 3 staff",
    ],
  },
  business: {
    key: "business",
    name: "Business",
    price: 20000,
    yearlyPrice: 200000,
    period: "month",
    description: "Teams, branches, and fuller reports.",
    features: [
      "Everything in Growth",
      "Unlimited staff and roles",
      "Multiple branches",
      "Reports and VAT",
      "Priority support",
    ],
  },
};

const LEGACY_PLANS = {
  basic: "growth",
  premium: "business",
};

const planAmount = (plan, interval = "month") => {
  if (!plan || plan.price <= 0) return 0;
  return interval === "year" ? plan.yearlyPrice : plan.price;
};

const planPeriodMonths = (interval = "month") =>
  interval === "year" ? 12 : 1;

const PAID_PLANS = new Set([
  "starter",
  "growth",
  "business",
  "custom",
  "basic",
  "premium",
]);

const planLabel = (key) => {
  if (!key || key === "free") return "No plan";
  if (key === "custom") return "Custom";
  const mapped = LEGACY_PLANS[key] || key;
  return PLANS[mapped]?.name || "No plan";
};

const hasActivePlan = (plan, expiry) => {
  if (!PAID_PLANS.has(String(plan || ""))) return false;
  const ends = new Date(expiry || 0).getTime();
  return Number.isFinite(ends) && ends > Date.now();
};

module.exports = {
  PLANS,
  planAmount,
  planPeriodMonths,
  planLabel,
  hasActivePlan,
};
