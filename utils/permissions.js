const PERMISSIONS = {
  "dashboard.view": { label: "View dashboard", group: "Dashboard" },
  "products.view": { label: "View products", group: "Products" },
  "products.manage": { label: "Create and edit products", group: "Products" },
  "sales.view": { label: "View sales", group: "Sales" },
  "sales.create": { label: "Create sales", group: "Sales" },
  "sales.manage": { label: "Edit and void sales", group: "Sales" },
  "orders.view": { label: "View orders", group: "Orders" },
  "orders.manage": { label: "Fulfill and update orders", group: "Orders" },
  "purchases.view": { label: "View purchases", group: "Purchases" },
  "purchases.manage": { label: "Create and edit purchases", group: "Purchases" },
  "expenses.view": { label: "View expenses", group: "Expenses" },
  "expenses.manage": { label: "Create and edit expenses", group: "Expenses" },
  "customers.view": { label: "View customers", group: "Customers" },
  "customers.manage": { label: "Create and edit customers", group: "Customers" },
  "suppliers.view": { label: "View suppliers", group: "Suppliers" },
  "suppliers.manage": { label: "Create and edit suppliers", group: "Suppliers" },
  "cash.view": { label: "View cash book", group: "Cash" },
  "cash.manage": { label: "Record cash movements", group: "Cash" },
  "reports.view": { label: "View reports", group: "Reports" },
  "settings.view": { label: "View settings", group: "Settings" },
  "settings.manage": { label: "Change business settings", group: "Settings" },
  "storefront.manage": { label: "Manage storefront", group: "Storefront" },
  "billing.manage": { label: "Manage billing and subscriptions", group: "Billing" },
  "team.view": { label: "View team members", group: "Team" },
  "team.manage": { label: "Invite users and set privileges", group: "Team" },
  "notifications.view": { label: "View notifications", group: "Notifications" },
};

const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

const ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter(
    (key) => !["team.manage", "billing.manage"].includes(key)
  ),
  staff: [
    "dashboard.view",
    "products.view",
    "sales.view",
    "sales.create",
    "orders.view",
    "orders.manage",
    "purchases.view",
    "expenses.view",
    "customers.view",
    "customers.manage",
    "suppliers.view",
    "reports.view",
    "notifications.view",
    "settings.view",
  ],
};

const resolvePermissions = (role, overrides) => {
  let list = overrides;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch (error) {
      list = [];
    }
  }
  if (Array.isArray(list) && list.length > 0) {
    return list.filter((key) => PERMISSIONS[key]);
  }
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.staff;
};

const hasPermission = (user, permission) => {
  if (!user) return false;
  if (user.role === "owner") return true;
  const granted = resolvePermissions(user.role, user.permissions);
  return granted.includes(permission);
};

const serializeUser = (user) => {
  const json = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete json.password;
  json.permissionOverrides = Array.isArray(json.permissions)
    ? json.permissions
    : [];
  json.permissions = resolvePermissions(json.role, json.permissions);
  return json;
};

const permissionCatalog = () =>
  Object.entries(PERMISSIONS).map(([key, meta]) => ({
    key,
    ...meta,
  }));

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  resolvePermissions,
  hasPermission,
  serializeUser,
  permissionCatalog,
};
