import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* =========================
   STRIPE WEBHOOK
   ========================= */

app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const signature = req.headers["stripe-signature"];
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      const rawBody = req.body.toString("utf8");

      if (!signature || !secret) {
        return res.status(400).send("Missing Stripe signature");
      }

      const parts = signature.split(",");

      const timestamp = parts
        .find((p) => p.startsWith("t="))
        ?.slice(2);

      const signatures = parts
        .filter((p) => p.startsWith("v1="))
        .map((p) => p.slice(3));

      if (!timestamp || signatures.length === 0) {
        return res.status(400).send("Invalid Stripe signature");
      }

      const age = Math.abs(Date.now() / 1000 - Number(timestamp));

      if (age > 300) {
        return res.status(400).send("Expired webhook");
      }

      const signedPayload = `${timestamp}.${rawBody}`;

      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");

      const valid = signatures.some((sig) => {
        const a = Buffer.from(sig, "utf8");
        const b = Buffer.from(expectedSignature, "utf8");

        return (
          a.length === b.length &&
          crypto.timingSafeEqual(a, b)
        );
      });

      if (!valid) {
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(rawBody);

      console.log("Stripe webhook:", event.type);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        console.log(
          "TextBot: Basic subscription completed.",
          session.customer_details?.email || "no email"
        );
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(400).send("Invalid webhook");
    }
  }
);

/* =========================
   JSON API
   ========================= */

app.use(express.json({ limit: "1mb" }));

/* =========================
   AI GENERATOR
   ========================= */

app.post("/api/generate", async (req, res) => {
  try {
    const {
      textType,
      business,
      details,
      style,
      language
    } = req.body;

    const prompt = `
Ти си TextBot — професионален AI копирайтър.

Напиши качествен текст според следните данни:

Тип текст:
${textType || "Не е посочен"}

Бизнес / цел:
${business || "Не е посочен"}

Какво трябва да съдържа:
${details || "Не е посочено"}

Стил:
${style || "Професионален"}

Език:
${language || "Български"}

Пиши естествено, ясно и професионално.
Не обяснявай какво правиш.
Дай директно готовия текст за използване.
`;

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input: prompt
    });

    res.json({
      text: response.output_text
    });
  } catch (error) {
    console.error("OpenAI error:", error);

    res.status(500).json({
      error: "AI generation failed"
    });
  }
});

/* =========================
   STRIPE CHECKOUT
   ========================= */

app.post("/api/create-checkout", async (req, res) => {
  try {
    const priceId = process.env.STRIPE_PRICE_BASIC;

    if (!priceId) {
      return res.status(500).json({
        error: "Stripe price is not configured"
      });
    }

    const baseUrl =
      process.env.APP_URL ||
      "https://textbot-ai-bg.onrender.com";

    const params = new URLSearchParams();

    params.append("mode", "subscription");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");

    params.append(
      "success_url",
      `${baseUrl}/?payment=success`
    );

    params.append(
      "cancel_url",
      `${baseUrl}/?payment=cancelled`
    );

    const response = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );

    const session = await response.json();

    if (!response.ok) {
      console.error("Stripe error:", session);

      return res.status(500).json({
        error: "Stripe checkout failed"
      });
    }

    res.json({
      url: session.url
    });
  } catch (error) {
    console.error("Checkout error:", error);

    res.status(500).json({
      error: "Stripe checkout failed"
    });
  }
});

/* =========================
   WEBSITE
   ========================= */

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================
   SERVER
   ========================= */

const port = process.env.PORT || 10000;

app.listen(port, "0.0.0.0", () => {
  console.log(`TextBot running on port ${port}`);
});
