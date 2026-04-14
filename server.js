require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
app.disable("x-powered-by");

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

const root = __dirname;
const dataDir = path.join(root, "data");
const uploadsDir = path.join(root, "uploads");
const usersFile = path.join(root, "users.json");
const accountsFile = path.join(root, "accounts.json");
const indexHtmlPath = path.join(root, "index.html");
const SESSION_COOKIE = "vcard_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const OTP_TTL_MS = 1000 * 60 * 10; // 10 minutes
const OTP_RESEND_MS = 1000 * 45; // 45 seconds
const OTP_MAX_ATTEMPTS = 5;
const sessions = new Map();
const signupOtps = new Map();

function ensureStorage() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(usersFile)) {
      fs.writeFileSync(usersFile, "[]", "utf8");
    }
    if (!fs.existsSync(accountsFile)) {
      fs.writeFileSync(accountsFile, "[]", "utf8");
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

function readAccounts() {
  try {
    const raw = fs.readFileSync(accountsFile, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2), "utf8");
}

function findAccountByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return { accounts: [], idx: -1, account: null };
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => String((a && a.email) || "").trim().toLowerCase() === normalized);
  if (idx < 0) return { accounts, idx: -1, account: null };
  return { accounts, idx, account: accounts[idx] || null };
}

function findAccountById(id) {
  const key = String(id || "").trim();
  if (!key) return { accounts: [], idx: -1, account: null };
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => String((a && a.id) || "") === key);
  if (idx < 0) return { accounts, idx: -1, account: null };
  return { accounts, idx, account: accounts[idx] || null };
}

function findUserBySlug(slug) {
  const users = readUsers();
  const idx = users.findIndex((u) => String((u && u.card_slug) || "").trim().toLowerCase() === slug);
  if (idx < 0) return { users, idx: -1, user: null };
  return { users, idx, user: users[idx] || null };
}

function findUserByCustomDomainPath(domain, pathName) {
  const d = String(domain || "").trim().toLowerCase();
  const p = String(pathName || "").trim().toLowerCase();
  if (!d || !p) return { users: [], idx: -1, user: null };
  const users = readUsers();
  const idx = users.findIndex((u) => {
    const ud = String((u && u.custom_domain) || "").trim().toLowerCase();
    const up = String((u && u.custom_path) || "").trim().toLowerCase();
    return ud === d && up === p;
  });
  if (idx < 0) return { users, idx: -1, user: null };
  return { users, idx, user: users[idx] || null };
}

function getRequestHostName(req) {
  const forwarded = String(req.get("x-forwarded-host") || "").trim();
  const hostRaw = (forwarded ? forwarded.split(",")[0] : req.get("host") || "").trim().toLowerCase();
  return hostRaw.replace(/:\d+$/, "");
}

function normalizeDomainInput(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return s;
}

function isValidDomainInput(raw) {
  const s = normalizeDomainInput(raw);
  if (!s) return false;
  if (s.length > 253) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s);
}

function normalizeCustomPath(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function isValidCustomPath(pathName) {
  const p = normalizeCustomPath(pathName);
  return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(p);
}

function buildCardUrl(req, slug, customDomain, customPath) {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  const d = normalizeDomainInput(customDomain);
  const p = normalizeCustomPath(customPath);
  if (d && p) {
    return "https://" + d + "/" + p;
  }
  return getPublicBaseUrl(req) + "/" + cleanSlug;
}

function syncAccountCardLinks(accountId, req, users, accounts) {
  const aid = String(accountId || "");
  if (!aid) return;
  const aIdx = accounts.findIndex((a) => String((a && a.id) || "") === aid);
  if (aIdx < 0 || !accounts[aIdx]) return;
  const account = accounts[aIdx];
  const cards = Array.isArray(account.cards) ? account.cards : [];
  cards.forEach((card) => {
    const slug = String((card && card.slug) || "").trim().toLowerCase();
    if (!slug) return;
    const user = users.find((u) => String((u && u.card_slug) || "").trim().toLowerCase() === slug);
    if (!user) return;
    card.profile_link = buildCardUrl(req, slug, user.custom_domain, user.custom_path);
  });
  account.cards = cards;
  accounts[aIdx] = account;
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
  "card",
  "preview",
  "profile",
  "signup",
  "login",
  "dashboard",
  "analytics",
  "auth",
  "domain",
  "my-cards",
  "analytics-data",
  "config",
  "slug-status",
  "create-order",
  "save-profile",
  "complete",
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

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtmlAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toAbsoluteUrl(req, raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return getPublicBaseUrl(req) + s;
  return getPublicBaseUrl(req) + "/" + s.replace(/^\/+/, "");
}

function buildShareMeta(req, profile) {
  const name = String((profile && profile.firstname) || "").trim();
  const designation = String((profile && profile.designation) || "").trim();
  const company = String((profile && profile.companyname) || "").trim();
  const titleParts = [name, designation, company].filter(Boolean);
  const title = titleParts.length ? titleParts.join(" — ") : "Digital vCard";
  const about = stripHtml((profile && profile.about) || "");
  const descCore = [designation, company].filter(Boolean).join(" • ") || "Digital visiting card";
  const description = (descCore + (about ? " — " + about : "")).slice(0, 180);
  const image = toAbsoluteUrl(req, (profile && profile.logo) || "");
  return { title, description, image };
}

function renderCardHtmlForShare(req, profile, options) {
  let html = fs.readFileSync(indexHtmlPath, "utf8");
  const meta = buildShareMeta(req, profile);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtmlAttr(meta.title) + "</title>");
  html = html.replace(
    /<meta name="description" content="[^"]*">/i,
    '<meta name="description" content="' + escapeHtmlAttr(meta.description) + '">'
  );

  if (/<meta property="og:title" content="[^"]*">/i.test(html)) {
    html = html.replace(
      /<meta property="og:title" content="[^"]*">/i,
      '<meta property="og:title" content="' + escapeHtmlAttr(meta.title) + '">'
    );
  } else {
    html = html.replace(
      /<meta name="description" content="[^"]*">/i,
      function (m) {
        return m + '\n  <meta property="og:title" content="' + escapeHtmlAttr(meta.title) + '">';
      }
    );
  }
  if (/<meta property="og:description" content="[^"]*">/i.test(html)) {
    html = html.replace(
      /<meta property="og:description" content="[^"]*">/i,
      '<meta property="og:description" content="' + escapeHtmlAttr(meta.description) + '">'
    );
  } else {
    html = html.replace(
      /<meta property="og:title" content="[^"]*">/i,
      function (m) {
        return m + '\n  <meta property="og:description" content="' + escapeHtmlAttr(meta.description) + '">';
      }
    );
  }
  if (meta.image) {
    if (/<meta property="og:image" content="[^"]*">/i.test(html)) {
      html = html.replace(
        /<meta property="og:image" content="[^"]*">/i,
        '<meta property="og:image" content="' + escapeHtmlAttr(meta.image) + '">'
      );
    } else {
      html = html.replace(
        /<meta property="og:description" content="[^"]*">/i,
        function (m) {
          return m + '\n  <meta property="og:image" content="' + escapeHtmlAttr(meta.image) + '">';
        }
      );
    }
  } else {
    html = html.replace(/\s*<meta property="og:image" content="[^"]*">\s*/i, "\n");
  }
  if (options && options.slugOverride) {
    const script =
      '<script>window.__cardSlugOverride=' + JSON.stringify(String(options.slugOverride || "").trim()) + ";</script>";
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, script + "\n</head>");
    } else {
      html = script + html;
    }
  }
  return html;
}

function getPricing() {
  const basePaise = Number(process.env.CARD_PRICE_PAISE) || 300000;
  const gstPercent = Number(process.env.GST_PERCENT);
  const gst = Number.isFinite(gstPercent) && gstPercent >= 0 ? gstPercent : 18;
  const gstPaise = Math.round((basePaise * gst) / 100);
  const totalPaise = basePaise + gstPaise;
  return { basePaise, gstPercent: gst, gstPaise, totalPaise };
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

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const computed = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expectedHash, "hex"));
  } catch {
    return computed === expectedHash;
  }
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  raw.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i <= 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) return;
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function setSessionCookie(req, res, token) {
  const secure = (req.protocol || "").toLowerCase() === "https";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(req, res) {
  const secure = (req.protocol || "").toLowerCase() === "https";
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function createSession(accountId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    accountId: String(accountId || ""),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSessionAccount(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (!sess.expiresAt || sess.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const found = findAccountById(sess.accountId);
  if (found.idx < 0 || !found.account) {
    sessions.delete(token);
    return null;
  }
  sess.expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, sess);
  return { token, account: found.account };
}

function authRequired(req, res, next) {
  const sess = getSessionAccount(req);
  if (!sess || !sess.account) {
    return res.redirect("/login");
  }
  req.account = sess.account;
  req.sessionToken = sess.token;
  next();
}

function getAccountCardsWithStats(account) {
  const cards = Array.isArray(account && account.cards) ? account.cards : [];
  const users = readUsers();
  const userBySlug = new Map();
  users.forEach((u) => {
    const slug = String((u && u.card_slug) || "").trim().toLowerCase();
    if (!slug) return;
    userBySlug.set(slug, u);
  });

  const ownedFromUsers = users
    .filter((u) => String((u && u.owner_account_id) || "") === String((account && account.id) || ""))
    .map((u) => {
      const slug = String((u && u.card_slug) || "").trim().toLowerCase();
      return {
        slug,
        profile_link: String((u && u.profile_link) || "").trim() || "/" + slug,
        saved_at: null,
        view_count: Number((u && u.view_count) || 0) || 0,
      };
    });

  const merged = new Map();
  cards.forEach((c) => {
    const slug = String((c && c.slug) || "").trim().toLowerCase();
    if (!slug) return;
    const user = userBySlug.get(slug);
    merged.set(slug, {
      slug,
      profile_link: (user && user.profile_link) || (c && c.profile_link) || "/" + slug,
      saved_at: (c && c.saved_at) || null,
      view_count: Number((user && user.view_count) || 0) || 0,
    });
  });

  ownedFromUsers.forEach((c) => {
    if (!c.slug) return;
    if (!merged.has(c.slug)) {
      merged.set(c.slug, c);
      return;
    }
    const prev = merged.get(c.slug);
    prev.view_count = Math.max(Number(prev.view_count) || 0, Number(c.view_count) || 0);
    if (!prev.profile_link && c.profile_link) prev.profile_link = c.profile_link;
    merged.set(c.slug, prev);
  });

  return Array.from(merged.values()).sort((a, b) => {
    const ta = Date.parse(a.saved_at || 0) || 0;
    const tb = Date.parse(b.saved_at || 0) || 0;
    return tb - ta;
  });
}

function getMailConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 0);
  const secure = String(process.env.SMTP_SECURE || "").trim() === "1";
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from = String(process.env.SMTP_FROM || user || "").trim();
  const ready = !!(host && port && user && pass && from);
  return { ready, host, port, secure, user, pass, from };
}

let mailerCache = null;
function getMailer() {
  const cfg = getMailConfig();
  if (!cfg.ready) return null;
  if (mailerCache && mailerCache.key === JSON.stringify(cfg)) return mailerCache.tx;
  const tx = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  mailerCache = { key: JSON.stringify(cfg), tx };
  return tx;
}

async function sendMailMessage(to, subject, html, text) {
  const cfg = getMailConfig();
  const tx = getMailer();
  if (!cfg.ready || !tx) {
    throw new Error("Email service is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.");
  }
  await tx.sendMail({
    from: cfg.from,
    to,
    subject,
    text: text || "",
    html: html || "",
  });
}

function createOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtpCode(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

function verifyOtpCode(raw, storedHash) {
  if (!raw || !storedHash) return false;
  const calc = hashOtpCode(raw);
  try {
    return crypto.timingSafeEqual(Buffer.from(calc, "hex"), Buffer.from(storedHash, "hex"));
  } catch {
    return calc === storedHash;
  }
}

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "12mb";
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));

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

function uploadImageHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No image file received" });
  }
  res.json({ url: "/uploads/" + req.file.filename });
}
app.post("/upload-image", imageUpload.single("image"), uploadImageHandler);

function uploadVideoHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No video file received" });
  }
  res.json({ url: "/uploads/" + req.file.filename });
}
app.post("/upload-video", videoUpload.single("video"), uploadVideoHandler);

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

app.get("/signup", (req, res) => {
  const sess = getSessionAccount(req);
  if (sess && sess.account) {
    return res.redirect("/dashboard");
  }
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "signup.html"));
});

app.get("/login", (req, res) => {
  const sess = getSessionAccount(req);
  if (sess && sess.account) {
    return res.redirect("/dashboard");
  }
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "signup.html"));
});

app.post("/auth/signup", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const otp = String(req.body.otp || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: "Enter the 6-digit OTP sent to your email." });
  }
  const found = findAccountByEmail(email);
  if (found.idx >= 0) {
    return res.status(409).json({ error: "Account already exists. Please log in." });
  }
  const pending = signupOtps.get(email);
  if (!pending || !pending.otp_hash) {
    return res.status(400).json({ error: "Please request OTP first." });
  }
  if (pending.expires_at < Date.now()) {
    signupOtps.delete(email);
    return res.status(400).json({ error: "OTP expired. Request a new OTP." });
  }
  if ((pending.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    signupOtps.delete(email);
    return res.status(429).json({ error: "Too many invalid attempts. Request a fresh OTP." });
  }
  if (!verifyOtpCode(otp, pending.otp_hash)) {
    pending.attempts = Number(pending.attempts || 0) + 1;
    signupOtps.set(email, pending);
    return res.status(400).json({ error: "Invalid OTP. Please try again." });
  }
  signupOtps.delete(email);

  const pass = createPasswordRecord(password);
  const newAccount = {
    id: crypto.randomBytes(12).toString("hex"),
    name,
    email,
    password_salt: pass.salt,
    password_hash: pass.hash,
    cards: [],
    created_at: new Date().toISOString(),
  };
  try {
    const accounts = readAccounts();
    accounts.push(newAccount);
    writeAccounts(accounts);
    const token = createSession(newAccount.id);
    setSessionCookie(req, res, token);
    sendMailMessage(
      email,
      "Welcome to Digital vCard",
      "<p>Hi " +
        escapeHtmlAttr(name) +
        ",</p><p>Your account is ready. You can now log in, build your card, and track analytics from your dashboard.</p><p>Thanks for joining Digital vCard.</p>",
      "Hi " + name + ",\n\nYour account is ready. You can now build your card and view analytics from your dashboard.\n\nThanks for joining Digital vCard."
    ).catch((e) => {
      console.error("welcome email failed:", e.message || e);
    });
    res.json({
      ok: true,
      account: { id: newAccount.id, name: newAccount.name, email: newAccount.email, cards: [] },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/auth/send-signup-otp", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!name) return res.status(400).json({ error: "Name is required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  const found = findAccountByEmail(email);
  if (found.idx >= 0) {
    return res.status(409).json({ error: "Account already exists. Please log in." });
  }

  const cfg = getMailConfig();
  if (!cfg.ready) {
    return res.status(503).json({
      error: "Email service is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in .env.",
    });
  }

  const now = Date.now();
  const existing = signupOtps.get(email);
  if (existing && existing.last_sent_at && now - existing.last_sent_at < OTP_RESEND_MS) {
    const waitSec = Math.ceil((OTP_RESEND_MS - (now - existing.last_sent_at)) / 1000);
    return res.status(429).json({ error: "Please wait " + waitSec + "s before requesting another OTP." });
  }

  const code = createOtpCode();
  try {
    await sendMailMessage(
      email,
      "Your Digital vCard OTP",
      "<p>Hi " +
        escapeHtmlAttr(name) +
        ",</p><p>Your OTP for account verification is:</p><h2 style=\"letter-spacing:2px;\">" +
        code +
        "</h2><p>This OTP is valid for 10 minutes.</p>",
      "Hi " + name + ",\n\nYour OTP is: " + code + "\nThis OTP is valid for 10 minutes."
    );
    signupOtps.set(email, {
      otp_hash: hashOtpCode(code),
      expires_at: now + OTP_TTL_MS,
      attempts: 0,
      last_sent_at: now,
    });
    res.json({ ok: true, expiresInSec: Math.floor(OTP_TTL_MS / 1000) });
  } catch (e) {
    console.error("otp email failed:", e.message || e);
    res.status(503).json({ error: "Could not send OTP email right now. Please try again." });
  }
});

app.post("/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const found = findAccountByEmail(email);
  if (found.idx < 0 || !found.account) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if (!verifyPassword(password, found.account.password_salt, found.account.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const token = createSession(found.account.id);
  setSessionCookie(req, res, token);
  res.json({
    ok: true,
    account: {
      id: found.account.id,
      name: found.account.name,
      email: found.account.email,
      cards: Array.isArray(found.account.cards) ? found.account.cards : [],
    },
  });
});

app.post("/auth/logout", (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/auth/me", (req, res) => {
  const sess = getSessionAccount(req);
  if (!sess || !sess.account) {
    return res.status(401).json({ authenticated: false });
  }
  const cards = getAccountCardsWithStats(sess.account);
  const totalViews = cards.reduce((sum, card) => sum + (Number(card.view_count) || 0), 0);
  res.json({
    authenticated: true,
    account: {
      id: sess.account.id,
      name: sess.account.name,
      email: sess.account.email,
      cards,
      totalViews,
    },
  });
});

app.get("/my-cards", authRequired, (req, res) => {
  const cards = getAccountCardsWithStats(req.account);
  res.json({ cards });
});

app.get("/analytics-data", authRequired, (req, res) => {
  const cards = getAccountCardsWithStats(req.account);
  const totalCards = cards.length;
  const totalViews = cards.reduce((sum, card) => sum + (Number(card.view_count) || 0), 0);
  res.json({ totalCards, totalViews, cards });
});

app.get("/whitelabel/state", authRequired, (req, res) => {
  const accountId = String((req.account && req.account.id) || "");
  const users = readUsers();
  const cards = getAccountCardsWithStats(req.account);
  const mapped = users.find((u) => {
    if (String((u && u.owner_account_id) || "") !== accountId) return false;
    return !!(String((u && u.custom_domain) || "").trim() && String((u && u.custom_path) || "").trim());
  });
  res.json({
    cards,
    mapping: mapped
      ? {
          slug: String(mapped.card_slug || ""),
          customDomain: String(mapped.custom_domain || ""),
          customPath: String(mapped.custom_path || ""),
          url: buildCardUrl(req, mapped.card_slug, mapped.custom_domain, mapped.custom_path),
        }
      : null,
  });
});

app.post("/whitelabel/save", authRequired, (req, res) => {
  const accountId = String((req.account && req.account.id) || "");
  const slug = String(req.body.slug || "").trim().toLowerCase();
  const customDomain = normalizeDomainInput(req.body.customDomain || "");
  const customPath = normalizeCustomPath(req.body.customPath || "");
  if (!slug) return res.status(400).json({ error: "Card slug is required." });
  if (!isValidDomainInput(customDomain)) {
    return res.status(400).json({ error: "Enter a valid domain (example.com)." });
  }
  if (!isValidCustomPath(customPath)) {
    return res.status(400).json({ error: "Path must use letters, numbers, and hyphens only." });
  }
  const users = readUsers();
  const userIdx = users.findIndex(
    (u) =>
      String((u && u.card_slug) || "").trim().toLowerCase() === slug &&
      String((u && u.owner_account_id) || "") === accountId
  );
  if (userIdx < 0 || !users[userIdx]) {
    return res.status(404).json({ error: "Card not found for this account." });
  }
  const conflictIdx = users.findIndex((u, idx) => {
    if (idx === userIdx) return false;
    const d = String((u && u.custom_domain) || "").trim().toLowerCase();
    const p = String((u && u.custom_path) || "").trim().toLowerCase();
    return d === customDomain && p === customPath;
  });
  if (conflictIdx >= 0) {
    return res.status(409).json({ error: "This domain + path is already mapped to another card." });
  }
  users.forEach((u) => {
    if (String((u && u.owner_account_id) || "") !== accountId) return;
    if (String((u && u.card_slug) || "").trim().toLowerCase() === slug) return;
    delete u.custom_domain;
    delete u.custom_path;
    u.profile_link = buildCardUrl(req, u.card_slug);
  });
  const target = users[userIdx];
  target.custom_domain = customDomain;
  target.custom_path = customPath;
  target.profile_link = buildCardUrl(req, target.card_slug, customDomain, customPath);
  users[userIdx] = target;

  const accounts = readAccounts();
  syncAccountCardLinks(accountId, req, users, accounts);
  writeUsers(users);
  writeAccounts(accounts);
  res.json({
    ok: true,
    mapping: {
      slug: slug,
      customDomain: customDomain,
      customPath: customPath,
      url: buildCardUrl(req, slug, customDomain, customPath),
    },
  });
});

app.post("/whitelabel/clear", authRequired, (req, res) => {
  const accountId = String((req.account && req.account.id) || "");
  const users = readUsers();
  let changed = false;
  users.forEach((u) => {
    if (String((u && u.owner_account_id) || "") !== accountId) return;
    const had = !!(u.custom_domain || u.custom_path);
    delete u.custom_domain;
    delete u.custom_path;
    u.profile_link = buildCardUrl(req, u.card_slug);
    if (had) changed = true;
  });
  const accounts = readAccounts();
  syncAccountCardLinks(accountId, req, users, accounts);
  writeUsers(users);
  writeAccounts(accounts);
  res.json({ ok: true, changed });
});

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const pathName = String(req.path || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!pathName || pathName.includes("/")) return next();
  if (/[.]/.test(pathName)) return next();
  const host = getRequestHostName(req);
  if (!host) return next();
  const found = findUserByCustomDomainPath(host, pathName);
  if (found.idx < 0 || !found.user) return next();
  res.set("Cache-Control", "no-store");
  return res.type("html").send(
    renderCardHtmlForShare(req, found.user, {
      slugOverride: String(found.user.card_slug || "").trim().toLowerCase(),
    })
  );
});

app.get("/", (req, res) => {
  res.sendFile(path.join(root, "landing.html"));
});

app.get("/form", authRequired, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "form.html"));
});

app.get("/dashboard", authRequired, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "dashboard.html"));
});

app.get("/analytics", authRequired, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "analytics.html"));
});

app.get("/preview", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(root, "index.html"));
});

function configHandler(req, res) {
  const keyId = process.env.RAZORPAY_KEY_ID || "";
  const pricing = getPricing();
  const publicBase = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  const mainSite = (process.env.MAIN_SITE_URL || "").trim().replace(/\/+$/, "");
  res.json({
    razorpayKeyId: keyId,
    amountPaise: pricing.totalPaise,
    basePaise: pricing.basePaise,
    gstPercent: pricing.gstPercent,
    gstPaise: pricing.gstPaise,
    currency: "INR",
    configured: Boolean(keyId && process.env.RAZORPAY_KEY_SECRET),
    publicBaseUrl: publicBase,
    mainSiteUrl: mainSite,
  });
}
app.get("/config", configHandler);

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
    const pricing = getPricing();
    const amountPaise = Number(req.body.amountPaise) || pricing.totalPaise;
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
app.post("/create-order", authRequired, createOrderHandler);

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
  if (!req.account || !req.account.id) {
    return res.status(401).json({ error: "Please sign up or log in to publish your card." });
  }
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const allowInsecure = process.env.ALLOW_INSECURE_PUBLISH === "1";

  const slug = (req.body.slug || "").trim().toLowerCase();
  let profile = req.body.profile;
  const paymentId = req.body.razorpay_payment_id;
  const orderId = req.body.razorpay_order_id;
  const signature = req.body.razorpay_signature;

  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: "Invalid or reserved card URL (use lowercase letters, numbers, hyphens)." });
  }
  if (typeof profile === "string") {
    try {
      profile = JSON.parse(profile);
    } catch {
      return res.status(400).json({ error: "Invalid profile payload" });
    }
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

  profile.profile_link = buildCardUrl(req, slug, profile.custom_domain, profile.custom_path);
  profile.card_slug = slug;
  profile.view_count = 0;
  profile.owner_account_id = req.account.id;

  try {
    const users = readUsers();
    users.push(profile);
    writeUsers(users);
    const foundAccount = findAccountById(req.account.id);
    if (foundAccount.idx >= 0 && foundAccount.account) {
      const cards = Array.isArray(foundAccount.account.cards) ? foundAccount.account.cards : [];
      cards.push({
        slug,
        profile_link: profile.profile_link,
        saved_at: new Date().toISOString(),
      });
      foundAccount.account.cards = cards;
      foundAccount.accounts[foundAccount.idx] = foundAccount.account;
      writeAccounts(foundAccount.accounts);
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not save card" });
  }

  res.json({ ok: true, path: "/" + slug });
}

app.post("/save-profile", authRequired, handlePublish);
app.post("/complete", authRequired, handlePublish);
app.post("/publish", authRequired, handlePublish);

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

app.use(express.static(root, { index: false }));

app.get("/:slug", (req, res, next) => {
  const s = req.params.slug;
  if (/[.]/.test(s)) return next();
  if (RESERVED_SLUGS.has(s.toLowerCase())) return next();
  res.set("Cache-Control", "no-store");
  try {
    const found = findUserBySlug(String(s).trim().toLowerCase());
    if (found && found.user) {
      return res.type("html").send(renderCardHtmlForShare(req, found.user));
    }
  } catch (e) {
    console.error("share meta render failed:", e);
  }
  res.sendFile(indexHtmlPath);
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
