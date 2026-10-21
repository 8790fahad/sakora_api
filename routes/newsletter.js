const express = require("express");
const db = require("../models");

const router = express.Router();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/", async (req, res) => {
  try {
    if (req.body.company) {
      return res.json({
        success: true,
        message: "You are on the list.",
      });
    }

    const email = String(req.body.email || "").trim().toLowerCase();
    if (!emailPattern.test(email) || email.length > 180) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address.",
      });
    }

    const [, created] = await db.NewsletterSubscriber.findOrCreate({
      where: { email },
      defaults: { email, source: "website" },
    });

    return res.status(created ? 201 : 200).json({
      success: true,
      message: created
        ? "You are on the list."
        : "This email is already subscribed.",
    });
  } catch (error) {
    console.error("Newsletter signup failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not subscribe just now. Please try again.",
    });
  }
});

module.exports = router;
