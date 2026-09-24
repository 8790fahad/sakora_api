const express = require("express");
const moment = require("moment");
const { body, query } = require("express-validator");
const { Op } = require("sequelize");
const db = require("../models");
const { authenticate, requirePermission } = require("../middleware/auth");
const { handleValidationErrors } = require("../utils/validation");
const { errorResponse, successResponse } = require("../utils/helpers");

const router = express.Router();

const periodWhere = (from, to, field = "date") => {
  const where = {};
  if (from || to) {
    where[field] = {};
    if (from) where[field][Op.gte] = from;
    if (to) where[field][Op.lte] = to;
  }
  return where;
};

const sumField = (rows, field) =>
  rows.reduce((total, row) => total + parseFloat(row[field] || 0), 0);

router.get(
  "/summary",
  authenticate,
  requirePermission("reports.view"),
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const from = req.query.from || moment().startOf("month").format("YYYY-MM-DD");
      const to = req.query.to || moment().format("YYYY-MM-DD");
      const businessId = req.user.businessId;
      const business = await db.Business.findByPk(businessId);

      const sales = await db.Sale.findAll({
        where: {
          businessId,
          status: { [Op.ne]: "cancelled" },
          ...periodWhere(from, to, "date"),
        },
        attributes: ["id", "saleNumber", "date", "subtotal", "taxAmount", "total"],
        order: [["date", "DESC"]],
        limit: 50,
      });

      const purchases = await db.Purchase.findAll({
        where: {
          businessId,
          status: { [Op.ne]: "cancelled" },
          ...periodWhere(from, to, "date"),
        },
        attributes: ["id", "purchaseNumber", "date", "subtotal", "taxAmount", "total"],
        order: [["date", "DESC"]],
        limit: 50,
      });

      const orders = await db.Order.findAll({
        where: {
          businessId,
          paymentStatus: "paid",
          status: { [Op.ne]: "cancelled" },
          createdAt: {
            [Op.gte]: moment(from).startOf("day").toDate(),
            [Op.lte]: moment(to).endOf("day").toDate(),
          },
        },
        attributes: ["id", "orderNumber", "createdAt", "subtotal", "taxAmount", "total"],
        order: [["createdAt", "DESC"]],
        limit: 50,
      });

      const payments = await db.VatPayment.findAll({
        where: {
          businessId,
          ...periodWhere(from, to, "date"),
        },
        order: [["date", "DESC"]],
      });

      const outputVat = sumField(sales, "taxAmount") + sumField(orders, "taxAmount");
      const inputVat = sumField(purchases, "taxAmount");
      const payable = outputVat - inputVat;
      const paid = sumField(payments, "amount");
      const netPayable = payable - paid;

      res.json(
        successResponse("VAT summary", {
          setup: {
            enabled: Boolean(business.taxEnabled),
            name: business.taxName || "VAT",
            rate: parseFloat(business.taxRate || 0),
            tin: business.taxTin || "",
          },
          period: { from, to },
          outputVat,
          inputVat,
          payable,
          paid,
          netPayable,
          sales,
          purchases,
          orders,
          payments,
        })
      );
    } catch (error) {
      res.status(500).json(errorResponse("Failed to load VAT summary", error.message));
    }
  }
);

router.post(
  "/payments",
  authenticate,
  requirePermission("settings.manage"),
  [
    body("amount").isFloat({ min: 0.01 }),
    body("date").isISO8601(),
    body("paymentMethod").optional().isString(),
    body("reference").optional().trim().isLength({ max: 80 }),
    body("notes").optional().trim(),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const payment = await db.VatPayment.create({
        businessId: req.user.businessId,
        createdBy: req.user.id,
        amount: parseFloat(req.body.amount),
        date: req.body.date,
        paymentMethod: req.body.paymentMethod || "bank",
        reference: req.body.reference || null,
        notes: req.body.notes || null,
      });

      res.status(201).json(
        successResponse("VAT payment recorded. Payable is now net of this amount.", {
          payment,
        })
      );
    } catch (error) {
      res.status(500).json(errorResponse("Failed to record VAT payment", error.message));
    }
  }
);

module.exports = router;
