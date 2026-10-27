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

// payMonths is how many list-price months are charged for that term.
// 12 months matches yearlyPrice (2 months free). 24 is 25% off. 48 is 33% off.
const BILLING_TERMS = [
  { months: 1, payMonths: 1, label: "1 month" },
  { months: 12, payMonths: 10, label: "12 months" },
  { months: 24, payMonths: 18, label: "24 months" },
  { months: 48, payMonths: 32, label: "48 months", bestValue: true },
];

const planAmount = (plan, interval = "month") => {
  if (!plan || plan.price <= 0) return 0;
  return interval === "year" ? plan.yearlyPrice : plan.price;
};

const planPeriodMonths = (interval = "month") =>
  interval === "year" ? 12 : 1;

const quoteTerm = (plan, months) => {
  const term = BILLING_TERMS.find((item) => item.months === Number(months));
  if (!plan || plan.price <= 0 || !term) return null;
  const listPrice = plan.price * term.months;
  const amount =
    term.months === 12 ? plan.yearlyPrice : plan.price * term.payMonths;
  const save = Math.max(0, listPrice - amount);
  return {
    months: term.months,
    label: term.label,
    bestValue: Boolean(term.bestValue),
    listPrice,
    amount,
    save,
    percentOff: listPrice ? Math.round((save / listPrice) * 100) : 0,
    perMonth: Math.round(amount / term.months),
    listPerMonth: plan.price,
  };
};

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
  BILLING_TERMS,
  planAmount,
  planPeriodMonths,
  quoteTerm,
  planLabel,
  hasActivePlan,
};
