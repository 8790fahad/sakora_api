const PLANS = {
  free: {
    key: "free",
    name: "Starter",
    price: 0,
    yearlyPrice: 0,
    period: "month",
    description: "Start selling from your phone at no cost",
    features: [
      "1 shop and 1 user",
      "Up to 50 products",
      "Record cash and transfer sales",
      "Basic inventory and low-stock alerts",
      "Daily sales on your home screen",
    ],
  },
  basic: {
    key: "basic",
    name: "Shop",
    price: 5000,
    yearlyPrice: 45000,
    period: "month",
    popular: true,
    description: "Online shop, WhatsApp selling, and invoices",
    features: [
      "Unlimited products",
      "Shareable online shop",
      "WhatsApp product and invoice share",
      "Order management",
      "Email and SMS alerts",
      "Up to 3 staff",
      "Squad checkout for customers",
    ],
  },
  premium: {
    key: "premium",
    name: "Business",
    price: 15000,
    yearlyPrice: 120000,
    period: "month",
    description: "For teams, branches, and growing stores",
    features: [
      "Everything in Shop",
      "Unlimited staff and roles",
      "Multiple branches",
      "Advanced reports",
      "Priority support",
    ],
  },
};

const planAmount = (plan, interval = "month") => {
  if (!plan || plan.price <= 0) return 0;
  return interval === "year" ? plan.yearlyPrice : plan.price;
};

const planPeriodMonths = (interval = "month") =>
  interval === "year" ? 12 : 1;

module.exports = { PLANS, planAmount, planPeriodMonths };
