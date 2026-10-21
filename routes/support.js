const express = require("express");
const db = require("../models");
const { authenticate } = require("../middleware/auth");
const { enqueueSafe } = require("../queues/jobQueue");

const router = express.Router();

const clean = (value, max) => String(value || "").trim().slice(0, max);

const authorName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "You";

async function findTicket(req, id) {
  return db.SupportTicket.findOne({
    where: { id, businessId: req.user.businessId },
  });
}

function notifySupport(req, ticket, body) {
  const to = process.env.SUPPORT_EMAIL;
  if (!to) return;
  const shop = req.user.business?.name || "A shop";
  enqueueSafe("notify.email", {
    businessId: req.user.businessId,
    to,
    subject: `Support: ${ticket.subject}`,
    text: `${shop} (${req.user.email})\n\n${body}`,
    templateKey: "support",
  });
}

router.get("/", authenticate, async (req, res) => {
  try {
    const tickets = await db.SupportTicket.findAll({
      where: { businessId: req.user.businessId },
      include: [
        {
          model: db.User,
          as: "user",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      order: [["updatedAt", "DESC"]],
      limit: 50,
    });

    res.json({
      success: true,
      data: {
        items: tickets.map((ticket) => ({
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          author: authorName(ticket.user),
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
        })),
      },
    });
  } catch (error) {
    console.error("List support tickets failed:", error);
    res.status(500).json({ success: false, message: "Could not load support requests." });
  }
});

router.get("/:id", authenticate, async (req, res) => {
  try {
    const ticket = await findTicket(req, req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    const messages = await db.SupportMessage.findAll({
      where: { ticketId: ticket.id, businessId: req.user.businessId },
      include: [
        {
          model: db.User,
          as: "user",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      order: [["createdAt", "ASC"]],
    });
    res.json({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          createdAt: ticket.createdAt,
        },
        messages: messages.map((message) => ({
          id: message.id,
          body: message.body,
          author: message.author,
          name: message.author === "support" ? "Sakora" : authorName(message.user),
          createdAt: message.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("Load support ticket failed:", error);
    res.status(500).json({ success: false, message: "Could not open this request." });
  }
});

router.post("/", authenticate, async (req, res) => {
  try {
    const subject = clean(req.body.subject, 160);
    const body = clean(req.body.message, 4000);
    if (subject.length < 3 || body.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Add a subject and a short message.",
      });
    }

    const ticket = await db.SupportTicket.create({
      businessId: req.user.businessId,
      userId: req.user.id,
      subject,
      status: "open",
    });
    await db.SupportMessage.create({
      ticketId: ticket.id,
      businessId: req.user.businessId,
      userId: req.user.id,
      author: "merchant",
      body,
    });
    notifySupport(req, ticket, body);

    res.status(201).json({
      success: true,
      message: "Message sent. We will reply here.",
      data: { id: ticket.id },
    });
  } catch (error) {
    console.error("Create support ticket failed:", error);
    res.status(500).json({ success: false, message: "Could not send your message." });
  }
});

router.post("/:id/messages", authenticate, async (req, res) => {
  try {
    const ticket = await findTicket(req, req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    const body = clean(req.body.message, 4000);
    if (body.length < 2) {
      return res.status(400).json({ success: false, message: "Write a message first." });
    }
    await db.SupportMessage.create({
      ticketId: ticket.id,
      businessId: req.user.businessId,
      userId: req.user.id,
      author: "merchant",
      body,
    });
    if (ticket.status === "closed") {
      ticket.status = "open";
    }
    await ticket.save();
    notifySupport(req, ticket, body);
    res.status(201).json({ success: true, message: "Message sent." });
  } catch (error) {
    console.error("Support reply failed:", error);
    res.status(500).json({ success: false, message: "Could not send your message." });
  }
});

router.patch("/:id", authenticate, async (req, res) => {
  try {
    const ticket = await findTicket(req, req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    if (req.body.status === "closed" || req.body.status === "open") {
      ticket.status = req.body.status;
      await ticket.save();
    }
    res.json({ success: true, message: "Request updated." });
  } catch (error) {
    console.error("Update support ticket failed:", error);
    res.status(500).json({ success: false, message: "Could not update this request." });
  }
});

module.exports = router;
