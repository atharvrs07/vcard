require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const app = express();
app.disable("x-powered-by");

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

const root = __dirname;
const dataDir = path.join(root, "data");
const uploadsDir = path.join(root, "uploads");
const usersFile = path.join(root, "users.json");

function ensureStorage() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(usersFile)) {
      fs.writeFileSync(usersFile, "[]", "utf8");
    }
  } catch (e) {}
}

ensureStorage();

function readUsers() {
  try {
    const raw = fs.readFileSync(usersFile, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), "utf8");
}

function findUserBySlug(slug) {
  const users = readUsers();
  const idx = users.findIndex((u) => String((u && u.card_slug) || "").trim().toLowerCase() === slug);
  if (idx < 0) return { users, idx: -1, user: null };
  return { users, idx, user: users[idx] || null };
}

function migrateLegacyDataFilesIfNeeded() {
  const users = readUsers();
  if (users.length > 0) return;
  let files = [];
  try {
    files = fs.readdirSync(dataDir).filter((name) => name.toLowerCase().endsWith(".json"));
  } catch {
    files = [];
  }
  if (!files.length) return;
  const incoming = [];
  files.forEach((name) => {
    try {
      const full = path.join(dataDir, name);
      const raw = fs.readFileSync(full, "utf8");
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      const slug = String(p.card_slug || name.replace(/\.json$/i, "")).trim().toLowerCase();
      if (!isValidSlug(slug)) return;
      p.card_slug = slug;
      incoming.push(p);
    } catch {}
  });
  if (incoming.length) {
    writeUsers(incoming);
    console.log(`Migrated ${incoming.length} legacy profile(s) from data/*.json to users.json`);
  }
}

migrateLegacyDataFilesIfNeeded();

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
  "profile",
  "config",
  "slug-status",
  "create-order",
  "save-profile",
  "publish",
  "upload-logo",
  "upload-image",
  "upload-video",
  "health",
  "uploads",
  "node_modules",
  "favicon.ico",
]);

function isValidSlug(s) {
  if (!s || typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(t) && !RESERVED_SLUGS.has(t);
}

function slugExists(slug) {
  const { idx } = findUserBySlug(slug);
  return idx >= 0;
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
    if (isValidSlug(cand) && !slugExists(cand)) out.push(cand);
  }
  let salt = 0;
  while (out.length < 5 && salt < 30) {
    const cand = prefix.slice(0, 20) + "-" + crypto.randomBytes(2).toString("hex");
    if (isValidSlug(cand) && !slugExists(cand) && !out.includes(cand)) out.push(cand);
    salt++;
  }
  return out.slice(0, 5);
}

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "12mb";
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use(function (req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    console.log(new Date().toISOString(), req.method, req.originalUrl || req.url);
  }
  next();
});

function uploadLogoHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No image file received" });
  }
  const publicPath = "/uploads/" + req.file.filename;
  res.json({ url: publicPath });
}
app.post("/upload-logo", uploadLogo.single("logo"), uploadLogoHandler);
app.post("/api/upload-logo", uploadLogo.single("logo"), uploadLogoHandler);

function uploadImageHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No image file received" });
  }
  res.json({ url: "/uploads/" + req.file.filename });
}
app.post("/upload-image", imageUpload.single("image"), uploadImageHandler);
app.post("/api/upload-image", imageUpload.single("image"), uploadImageHandler);

function uploadVideoHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No video file received" });
  }
  res.json({ url: "/uploads/" + req.file.filename });
}
app.post("/upload-video", videoUpload.single("video"), uploadVideoHandler);
app.post("/api/upload-video", videoUpload.single("video"), uploadVideoHandler);

function slugStatusHandler(req, res) {
  const slug = (req.query.slug || "").trim().toLowerCase();
  if (!slug) {
    return res.json({ valid: false, available: false, suggestions: [] });
  }
  if (!isValidSlug(slug)) {
    return res.json({ valid: false, available: false, suggestions: suggestAvailableSlugs("my-card") });
  }
  const taken = slugExists(slug);
  res.json({
    valid: true,
    available: !taken,
    suggestions: taken ? suggestAvailableSlugs(slug) : [],
  });
}
app.get("/slug-status", slugStatusHandler);
app.get("/api/slug-status", slugStatusHandler);

app.get("/", (req, res) => {
  res.sendFile(path.join(root, "landing.html"));
});

app.get("/form", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "form.html"));
});

app.get("/preview", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "index.html"));
});

function configHandler(req, res) {
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
}
app.get("/config", configHandler);
app.get("/api/config", configHandler);

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

async function createOrderHandler(req, res) {
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
}
app.post("/create-order", createOrderHandler);
app.post("/api/create-order", createOrderHandler);

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

function handlePublish(req, res) {
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
  if (slugExists(slug)) {
    return res.status(409).json({
      error: "This card URL is already taken.",
      suggestions: suggestAvailableSlugs(slug),
    });
  }

  const origin = getPublicBaseUrl(req);
  profile.profile_link = origin + "/" + slug;
  profile.card_slug = slug;
  profile.view_count = 0;

  try {
    const users = readUsers();
    users.push(profile);
    writeUsers(users);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not save card" });
  }

  res.json({ ok: true, path: "/" + slug });
}

app.post("/save-profile", handlePublish);
app.post("/publish", handlePublish);
app.post("/api/save-profile", handlePublish);
app.post("/api/publish", handlePublish);

function profileHandler(req, res) {
  res.set("Cache-Control", "no-store");
  const slug = (req.params.slug || "").trim().toLowerCase();
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }
  const found = findUserBySlug(slug);
  if (found.idx < 0 || !found.user) {
    return res.status(404).json({ error: "Card not found" });
  }
  try {
    const profile = found.user;
    let vc = Number(profile.view_count);
    if (Number.isNaN(vc)) vc = 0;
    profile.view_count = vc + 1;
    found.users[found.idx] = profile;
    writeUsers(found.users);
    res.type("json").send(JSON.stringify(profile));
  } catch (e) {
    res.status(500).json({ error: "Read failed" });
  }
}
app.get("/profile/:slug", profileHandler);
app.get("/api/profile/:slug", profileHandler);

app.use(express.static(root, { index: false }));

app.get("/:slug", (req, res, next) => {
  const s = req.params.slug;
  if (/[.]/.test(s)) return next();
  if (RESERVED_SLUGS.has(s.toLowerCase())) return next();
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "index.html"));
});

// Return JSON for body-parser errors so client never gets HTML/plaintext on POST routes.
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
