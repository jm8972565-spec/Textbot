import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const rawBody = req.body.toString("utf8");

    if (!signature || !secret) {
      return res.status(400).send("Missing Stripe signature");
    }

    const parts = signature.split(",");
    const timestamp = parts.find((p) => p.startsWith("t="))?.split("=")[1];
    const signatures = parts
      .filter((p) => p.startsWith("v1="))
      .map((p) => p.split("=")[1]);

    if (!timestamp || signatures.length === 0) {
      return res.status(400).send("Invalid Stripe signature");
    }

    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
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

      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });

    if (!valid) {
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(rawBody);

    console.log("Stripe webhook:", event.type);

    if (event.type === "checkout.session.completed") {
      console.log("TextBot: Basic subscription completed.");
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(400).send("Invalid webhook");
  }
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.post("/api/generate", async (req, res) => {
  try {
    const {
      request = "",
      business = "",
      details = "",
      style = "Професионален",
      language = "Български"
    } = req.body || {};

    if (!request.trim()) {
      return res.status(400).json({
        error: "Моля, опиши какъв текст искаш."
      });
    }

    const prompt = `Ти си TextBot — професионален AI копирайтър за бизнеси.

Напиши готов за използване текст.

Тип текст: ${request}
Бизнес/цел: ${business || "Не е уточнено"}
Допълнителни изисквания: ${details || "Няма"}
Стил: ${style}
Език: ${language}

Правила:
Пиши естествено и убедително.
Не измисляй конкретни факти, цени, адреси или обещания, ако не са дадени.
Не обяснявай процеса.
Върни само готовия текст.`;

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      instructions: "You are TextBot, a high-quality business copywriter.",
      input: prompt,
      reasoning: { effort: "none" },
      max_output_tokens: 1200
    });

    res.json({
      text: response.output_text
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Възникна грешка при AI генерацията."
    });
  }
});

app.post("/api/create-checkout", async (req, res) => {
  try {
    const priceId = process.env.STRIPE_PRICE_BASIC;

    if (!priceId) {
      return res.status(500).json({
        error: "Stripe Basic Price ID не е настроен."
      });
    }

    const host = req.get("host");
    const protocol = req.get("x-forwarded-proto") || "https";
    const baseUrl = `${protocol}://${host}`;

    const body = new URLSearchParams();

    body.append("mode", "subscription");
    body.append("line_items[0][price]", priceId);
    body.append("line_items[0][quantity]", "1");
    body.append("success_url", `${baseUrl}/?payment=success`);
    body.append("cancel_url", `${baseUrl}/?payment=cancelled`);

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      }
    );

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(session);

      return res.status(500).json({
        error: "Stripe не успя да създаде плащането."
      });
    }

    res.json({
      url: session.url
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Възникна грешка при Stripe."
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const port = process.env.PORT || 10000;

app.listen(port, "0.0.0.0", () => {
  console.log(`TextBot running on port ${port}`);
});
