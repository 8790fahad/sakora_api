const moment = require("moment");

// Generate unique numbers for invoices, receipts, etc.
const generateUniqueNumber = (prefix = "", length = 6) => {
  const timestamp = Date.now().toString().slice(-4);
  const random = Math.floor(Math.random() * Math.pow(10, length - 4))
    .toString()
    .padStart(length - 4, "0");
  return `${prefix}${timestamp}${random}`;
};

// Generate business/branch specific numbers
const generateBusinessNumber = (businessId, prefix = "", sequence = 1) => {
  const businessCode = businessId.slice(-4).toUpperCase();
  const sequenceStr = sequence.toString().padStart(4, "0");
  const yearMonth = moment().format("YYMM");
  return `${prefix}${businessCode}${yearMonth}${sequenceStr}`;
};

// Format currency
const formatCurrency = (amount, currency = "NGN", symbol = "₦") => {
  const num = parseFloat(amount) || 0;
  return {
    amount: num,
    formatted: `${symbol}${num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    currency,
    symbol,
  };
};

// Calculate profit for a sale item
const calculateProfit = (sellingPrice, costPrice, quantity = 1) => {
  const selling = parseFloat(sellingPrice) || 0;
  const cost = parseFloat(costPrice) || 0;
  const qty = parseFloat(quantity) || 0;

  const totalSelling = selling * qty;
  const totalCost = cost * qty;
  const profit = totalSelling - totalCost;
  const profitMargin = totalSelling > 0 ? (profit / totalSelling) * 100 : 0;

  return {
    profit,
    profitMargin,
    totalSelling,
    totalCost,
  };
};

// Calculate totals for transaction items
const calculateTransactionTotals = (items, taxRate = 0) => {
  let subtotal = 0;
  let totalProfit = 0;

  items.forEach((item) => {
    const itemTotal =
      parseFloat(item.quantity) * parseFloat(item.unitPrice || item.unitCost);
    subtotal += itemTotal;

    if (item.costPrice) {
      const profit = calculateProfit(
        item.unitPrice,
        item.costPrice,
        item.quantity
      );
      totalProfit += profit.profit;
    }
  });

  const taxAmount = (subtotal * parseFloat(taxRate)) / 100;
  const total = subtotal + taxAmount;

  return {
    subtotal,
    taxAmount,
    total,
    totalProfit,
    itemCount: items.length,
  };
};

const resolveTaxRate = (business, requestedRate) => {
  const requested = parseFloat(requestedRate);
  if (business?.taxEnabled) {
    if (!Number.isNaN(requested) && requested > 0) return requested;
    return parseFloat(business.taxRate || 0);
  }
  return Number.isNaN(requested) ? 0 : requested;
};

// Update running cash balance
const updateCashBalance = async (branchId, amount, type, db) => {
  try {
    // Get last transaction to get running balance
    const lastTransaction = await db.CashTransaction.findOne({
      where: { branchId },
      order: [["createdAt", "DESC"]],
    });

    const previousBalance = lastTransaction
      ? parseFloat(lastTransaction.runningBalance)
      : 0;
    const newBalance =
      type === "in"
        ? previousBalance + parseFloat(amount)
        : previousBalance - parseFloat(amount);

    return newBalance;
  } catch (error) {
    console.error("Error updating cash balance:", error);
    return 0;
  }
};

// Pagination helper
const getPagination = (page = 1, size = 20) => {
  const pageNum = parseInt(page, 10) || 1;
  const sizeNum = parseInt(size, 10) || 20;
  const limit = sizeNum > 100 ? 100 : sizeNum;
  const offset = (pageNum - 1) * limit;

  return { limit, offset };
};

// Response pagination info
const getPagingData = (data, page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  const currentPage = page ? +page : 1;

  return {
    items: data,
    pagination: {
      currentPage,
      totalPages,
      totalItems: total,
      itemsPerPage: limit,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1,
    },
  };
};

// Date range helpers
const getDateRange = (period = "today") => {
  const now = moment();

  switch (period) {
    case "today":
      return {
        startDate: now.startOf("day").toDate(),
        endDate: now.endOf("day").toDate(),
      };

    case "yesterday":
      return {
        startDate: now.subtract(1, "day").startOf("day").toDate(),
        endDate: now.subtract(1, "day").endOf("day").toDate(),
      };

    case "week":
      return {
        startDate: now.startOf("week").toDate(),
        endDate: now.endOf("week").toDate(),
      };

    case "month":
      return {
        startDate: now.startOf("month").toDate(),
        endDate: now.endOf("month").toDate(),
      };

    case "year":
      return {
        startDate: now.startOf("year").toDate(),
        endDate: now.endOf("year").toDate(),
      };

    default:
      return {
        startDate: now.startOf("day").toDate(),
        endDate: now.endOf("day").toDate(),
      };
  }
};

// Sanitize filename for file uploads
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-z0-9.-]/gi, "_")
    .toLowerCase()
    .substring(0, 100);
};

// Generate SKU
const generateSKU = (productName, categoryName = "") => {
  const cleanName = productName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const cleanCategory = categoryName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const timestamp = Date.now().toString().slice(-4);

  const nameCode = cleanName.substring(0, 3);
  const categoryCode = cleanCategory.substring(0, 2);

  return `${categoryCode}${nameCode}${timestamp}`;
};

// Error response helper
const errorResponse = (message = "An error occurred", details = null) => {
  return {
    success: false,
    message,
    ...(details && { details }),
  };
};

// Success response helper
const successResponse = (message = "Operation successful", data = null) => {
  return {
    success: true,
    message,
    ...(data && { data }),
  };
};

module.exports = {
  generateUniqueNumber,
  generateBusinessNumber,
  formatCurrency,
  calculateProfit,
  calculateTransactionTotals,
  resolveTaxRate,
  updateCashBalance,
  getPagination,
  getPagingData,
  getDateRange,
  sanitizeFilename,
  generateSKU,
  errorResponse,
  successResponse,
};
