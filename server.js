require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const app = express();

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

const root = __dirname;
const dataDir = path.join(root, "data");
const uploadsDir = path.join(root, "uploads");

function ensureDataDir() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (e) {}
}

ensureDataDir();

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
      const safe = allowed.includes(ext) ? ext : ".jpg";
      cb(null, Date.now() + "_" + crypto.randomBytes(4).toString("hex") + safe);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const uploadLogo = imageUpload;

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const allowed = [".mp4", ".webm", ".mov", ".mkv", ".ogg"];
      const safe = allowed.includes(ext) ? ext : ".mp4";
      cb(null, Date.now() + "_" + crypto.randomBytes(4).toString("hex") + safe);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const RESERVED_SLUGS = new Set([
  "form",
  "api",
  "card",
  "preview",
  "uploads",
  "node_modules",
  "favicon.ico",
]);

function isValidSlug(s) {
  if (!s || typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(t) && !RESERVED_SLUGS.has(t);
}

function profilePathForSlug(slug) {
  return path.join(dataDir, slug + ".json");
}

function slugExistsOnDisk(slug) {
  return fs.existsSync(profilePathForSlug(slug));
}

/** Canonical public URL for this deployment (e.g. https://ecard.xevonet.com). No trailing slash. */
function getPublicBaseUrl(req) {
  const explicit = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  return (req.protocol || "http") + "://" + (req.get("host") || "localhost");
}

function suggestAvailableSlugs(baseSlug) {
  const out = [];
  const b = String(baseSlug || "card")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);
  const prefix = b || "card";
  for (let n = 2; n <= 50 && out.length < 8; n++) {
    const cand = prefix + "-" + n;
    if (isValidSlug(cand) && !slugExistsOnDisk(cand)) out.push(cand);
  }
  let salt = 0;
  while (out.length < 5 && salt < 30) {
    const cand = prefix.slice(0, 20) + "-" + crypto.randomBytes(2).toString("hex");
    if (isValidSlug(cand) && !slugExistsOnDisk(cand) && !out.includes(cand)) out.push(cand);
    salt++;
  }
  return out.slice(0, 5);
}

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "12mb";
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.post("/api/upload-logo", uploadLogo.single("logo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file received" });
  }
  const publicPath = "/uploads/" + req.file.filename;
  res.json({ url: publicPath });
});

app.post("/api/upload-image", imageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file received" });
  }
  res.json({ url: "/uploads/" + req.file.filename });
});

app.post("/api/upload-video", videoUpload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file received" });
  }
  res.json({ url: "/uploads/" + req.file.filename });
});

app.get("/api/slug-status", (req, res) => {
  const slug = (req.query.slug || "").trim().toLowerCase();
  if (!slug) {
    return res.json({ valid: false, available: false, suggestions: [] });
  }
  if (!isValidSlug(slug)) {
    return res.json({ valid: false, available: false, suggestions: suggestAvailableSlugs("my-card") });
  }
  const taken = slugExistsOnDisk(slug);
  res.json({
    valid: true,
    available: !taken,
    suggestions: taken ? suggestAvailableSlugs(slug) : [],
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(root, "landing.html"));
});

app.get("/form", (req, res) => {
  res.sendFile(path.join(root, "form.html"));
});

app.get("/preview", (req, res) => {
  res.sendFile(path.join(root, "index.html"));
});

app.get("/api/config", (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID || "";
  const amountPaise = Number(process.env.CARD_PRICE_PAISE) || 45000;
  const publicBase = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  const mainSite = (process.env.MAIN_SITE_URL || "").trim().replace(/\/+$/, "");
  res.json({
    razorpayKeyId: keyId,
    amountPaise: amountPaise,
    currency: "INR",
    configured: Boolean(keyId && process.env.RAZORPAY_KEY_SECRET),
    publicBaseUrl: publicBase,
    mainSiteUrl: mainSite,
  });
});

app.get("/health", (req, res) => {
  res.type("text").send("ok");
});

async function razorpayCreateOrder(amountPaise, receipt) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    throw new Error("Razorpay keys missing (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)");
  }
  const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");
  const body = JSON.stringify({
    amount: amountPaise,
    currency: "INR",
    receipt: receipt || "rcpt_" + Date.now(),
  });
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + auth,
    },
    body: body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error && data.error.description ? data.error.description : "Order failed");
  }
  return { orderId: data.id, amount: data.amount, currency: data.currency, keyId: keyId };
}

app.post("/api/create-order", async (req, res) => {
  try {
    const defaultPaise = Number(process.env.CARD_PRICE_PAISE) || 45000;
    const amountPaise = Number(req.body.amountPaise) || defaultPaise;
    if (amountPaise < 100) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    const order = await razorpayCreateOrder(amountPaise, "vcard_" + Date.now());
    res.json(order);
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: String(e.message || e) });
  }
});

function verifyRazorpaySignature(orderId, paymentId, signature, secret) {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const body = orderId + "|" + paymentId;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return expected === signature;
  }
}

app.post("/api/publish", (req, res) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const allowInsecure = process.env.ALLOW_INSECURE_PUBLISH === "1";

  const slug = (req.body.slug || "").trim().toLowerCase();
  const profile = req.body.profile;
  const paymentId = req.body.razorpay_payment_id;
  const orderId = req.body.razorpay_order_id;
  const signature = req.body.razorpay_signature;

  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: "Invalid or reserved card URL (use lowercase letters, numbers, hyphens)." });
  }
  if (!profile || typeof profile !== "object") {
    return res.status(400).json({ error: "Missing profile" });
  }

  if (secret) {
    if (!paymentId || !orderId || !signature) {
      return res.status(400).json({ error: "Missing payment details" });
    }
    if (!verifyRazorpaySignature(orderId, paymentId, signature, secret)) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }
  } else if (!allowInsecure) {
    return res.status(503).json({
      error:
        "Server must set RAZORPAY_KEY_SECRET to verify payments, or ALLOW_INSECURE_PUBLISH=1 for local testing only.",
    });
  }

  delete profile.__preview;
  if (slugExistsOnDisk(slug)) {
    return res.status(409).json({
      error: "This card URL is already taken.",
      suggestions: suggestAvailableSlugs(slug),
    });
  }

  const origin = getPublicBaseUrl(req);
  profile.profile_link = origin + "/" + slug;
  profile.card_slug = slug;
  profile.view_count = 0;

  const file = profilePathForSlug(slug);
  try {
    fs.writeFileSync(file, JSON.stringify(profile, null, 2), "utf8");
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not save card" });
  }

  res.json({ ok: true, path: "/" + slug });
});

app.get("/api/profile/:slug", (req, res) => {
  const slug = (req.params.slug || "").trim().toLowerCase();
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }
  const file = profilePathForSlug(slug);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Card not found" });
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const profile = JSON.parse(raw);
    let vc = Number(profile.view_count);
    if (Number.isNaN(vc)) vc = 0;
    profile.view_count = vc + 1;
    fs.writeFileSync(file, JSON.stringify(profile, null, 2), "utf8");
    res.type("json").send(JSON.stringify(profile));
  } catch (e) {
    res.status(500).json({ error: "Read failed" });
  }
});

app.use(express.static(root, { index: false }));

app.get("/:slug", (req, res, next) => {
  const s = req.params.slug;
  if (/[.]/.test(s)) return next();
  if (RESERVED_SLUGS.has(s.toLowerCase())) return next();
  res.sendFile(path.join(root, "index.html"));
});

// Return JSON for body-parser errors so the client never gets HTML/plaintext on POST /api/*.
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error:
        "Card data exceeds the server size limit. Reduce text/images or ask the host to raise JSON_BODY_LIMIT and nginx client_max_body_size.",
    });
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }
  console.error(err);
  if (!res.headersSent) {
    const code =
      typeof err.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(code).json({ error: err.message || "Server error" });
  }
});

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  const pub = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const base = pub || `http://localhost:${PORT}`;
  console.log(`Digital vCard listening on port ${PORT}`);
  console.log(`  Public URL: ${base}/  |  Builder: ${base}/form`);
  if (!process.env.PUBLIC_BASE_URL) {
    console.log(`  Tip: set PUBLIC_BASE_URL=https://ecard.xevonet.com for production card links & QR codes.`);
  }
});
