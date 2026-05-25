require("dotenv").config();

const express = require("express");
const axios   = require("axios");
const moment  = require("moment");
const fs      = require("fs");
const path    = require("path");
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");

// ─── APP SETUP ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/ping", (req, res) => res.send("OK"));

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TILL_NAME       = "ALJAKI Enterprise";
const PAYBILL_NUMBER  = "0116399272";
const PAYBILL_NAME    = "Alvin";
const ADMIN_IDS       = ["6954749470"];
const SHORTCODE       = process.env.SHORTCODE;
const PASSKEY         = process.env.PASSKEY;
const CONSUMER_KEY    = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const CALLBACK_URL    = process.env.CALLBACK_URL || "";
const BOT_TOKEN       = "8426477735:AAGwMH0CxnxoMZZQnbHA1oVTWgmjErthCuk";
const ADMIN_USERNAME  = "@Naughtychatsupport";
const CRYPTO_ADDRESS  = "TQQ7Y4PKNs2rMuN2AzHGc2k43MuyMvrjy9";

// ─── CHANNEL ─────────────────────────────────────────────────────────────────
const CHANNEL_ID = -1003939463615;
const warnMs = 24 * 60 * 60 * 1000;

// ─── PLAN CONFIG ─────────────────────────────────────────────────────────────
const PLAN_DAYS = {
  "1 Hour":   0.04167,
  "6 Hours":  0.25,
  "1 Day":    1,
  "1 Week":   7,
  "2 Weeks":  14,
  "1 Month":  30,
  "6 Months": 180,
  "1 Year":   365,
};

// ─── PACKAGES & PRICING ──────────────────────────────────────────────────────
const PLANS = {
  premium_1hour:    { label: "1 Hour",    price: 30,   pkg: "Premium" },
  premium_6hours:   { label: "6 Hours",   price: 70,   pkg: "Premium" },
  premium_1day:     { label: "1 Day",     price: 100,  pkg: "Premium" },
  premium_1week:    { label: "1 Week",    price: 220,  pkg: "Premium" },
  premium_2weeks:   { label: "2 Weeks",   price: 400,  pkg: "Premium" },
  premium_1month:   { label: "1 Month",   price: 680,  pkg: "Premium" },
  premium_6months:  { label: "6 Months",  price: 3500, pkg: "Premium" },
  premium_1year:    { label: "1 Year",    price: 7000, pkg: "Premium" },

  explicit_1hour:   { label: "1 Hour",    price: 40,   pkg: "Explicit" },
  explicit_6hours:  { label: "6 Hours",   price: 80,   pkg: "Explicit" },
  explicit_1day:    { label: "1 Day",     price: 130,  pkg: "Explicit" },
  explicit_1week:   { label: "1 Week",    price: 190,  pkg: "Explicit" },
  explicit_2weeks:  { label: "2 Weeks",   price: 300,  pkg: "Explicit" },
  explicit_1month:  { label: "1 Month",   price: 450,  pkg: "Explicit" },
  explicit_6months: { label: "6 Months",  price: 2500, pkg: "Explicit" },
  explicit_1year:   { label: "1 Year",    price: 6200, pkg: "Explicit" },
};

// ─── IN-MEMORY STATE ──────────────────────────────────────────────────────────
const userSelections         = {};
let   pendingSTK             = {};
let   pendingManualApprovals = {};
const subTimers              = {};
const accessAttempts         = {};
const userInviteLinks        = {};
const broadcastState         = {};
const apologyState           = {};
let   autoExpireSubscriptions = true;

// ─── PERSISTENCE (JSON FALLBACK) ──────────────────────────────────────────────
function loadPendingSTK() {
  try {
    const file = path.join(__dirname, "pending_stk.json");
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) { console.error("⚠️ Could not load pending_stk.json:", e.message); }
  return {};
}
function savePendingSTK(data) {
  try { fs.writeFileSync(path.join(__dirname, "pending_stk.json"), JSON.stringify(data, null, 2)); }
  catch (e) { console.error("⚠️ Could not save pending_stk.json:", e.message); }
}
function loadUserSelections() {
  try {
    const file = path.join(__dirname, "user_selections.json");
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) { console.error("⚠️ Could not load user_selections.json:", e.message); }
  return {};
}
function saveUserSelection(chatId, data) {
  try {
    const all = loadUserSelections();
    all[cid(chatId)] = data;
    fs.writeFileSync(path.join(__dirname, "user_selections.json"), JSON.stringify(all, null, 2));
  } catch (e) { console.error("⚠️ Could not save user_selections.json:", e.message); }
}
function deleteUserSelection(chatId) {
  try {
    const all = loadUserSelections();
    delete all[cid(chatId)];
    fs.writeFileSync(path.join(__dirname, "user_selections.json"), JSON.stringify(all, null, 2));
  } catch (e) { console.error("⚠️ Could not delete user_selections.json entry:", e.message); }
}
function loadSubs() {
  try {
    const file = path.join(__dirname, "subscriptions.json");
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) { console.error("⚠️ Could not load subscriptions.json:", e.message); }
  return {};
}
function saveSubs(data) {
  try { fs.writeFileSync(path.join(__dirname, "subscriptions.json"), JSON.stringify(data, null, 2)); }
  catch (e) { console.error("⚠️ Could not save subscriptions.json:", e.message); }
}

pendingSTK = loadPendingSTK();
Object.assign(userSelections, loadUserSelections());

function saveSubEntry(chatId, planLabel, expiresAt, username, inviteLink = null, inviteLinkId = null, pkg = null) {
  const data = loadSubs();
  data[cid(chatId)] = { planLabel, expiresAt, username, inviteLink, inviteLinkId, pkg };
  saveSubs(data);
}
function removeSubEntry(chatId) {
  const data = loadSubs();
  delete data[cid(chatId)];
  saveSubs(data);
}

const cid = (id) => String(id);
function logError(label, err) { console.error(`❌ ${label}:`, err.message); }

// ─── BOT SETUP ────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

(async () => {
  try {
    await bot.deleteWebHook({ drop_pending_updates: true });
    console.log("✅ Webhook cleared");
  } catch (err) {
    console.warn("⚠️ Could not delete webhook:", err.message);
  }
  await new Promise((r) => setTimeout(r, 1500));
  bot.startPolling({ interval: 1000, params: { timeout: 10 } });
  console.log("✅ Bot started in long-polling mode.");
})();

bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.message.includes("409")) {
    console.warn("⚠️ Polling 409 — waiting for Telegram to settle...");
  } else {
    console.error("❌ Polling error:", err.message);
  }
});

// ─── MESSAGING HELPERS ────────────────────────────────────────────────────────
async function safeSendMessage(chatId, text, opts = {}) {
  const maxRetries = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await bot.sendMessage(cid(chatId), text, { parse_mode: "Markdown", ...opts });
    } catch (err) {
      lastErr = err;
      const isParseError = err.message && (
        err.message.includes("can't parse entities") ||
        err.message.includes("Bad Request: can't parse")
      );
      if (isParseError) {
        console.warn(`⚠️ safeSendMessage [${chatId}]: Markdown parse error — retrying as plain text`);
        try {
          const plainOpts = { ...opts };
          delete plainOpts.parse_mode;
          const plainText = text
            .replace(/\*/g, "")
            .replace(/_/g, "")
            .replace(/`/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
          return await bot.sendMessage(cid(chatId), plainText, plainOpts);
        } catch (plainErr) {
          lastErr = plainErr;
          logError(`safeSendMessage plain fallback [${chatId}]`, plainErr);
        }
      }
      if (attempt < maxRetries) {
        console.warn(`⚠️ safeSendMessage [${chatId}] attempt ${attempt} failed: ${err.message} — retrying in ${attempt}s`);
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastErr;
}

async function sendWithTyping(chatId, text, opts = {}, typingDelayMs = 800) {
  try {
    await bot.sendChatAction(cid(chatId), "typing");
    await new Promise(r => setTimeout(r, typingDelayMs));
  } catch (_) {}
  return await safeSendMessage(chatId, text, opts);
}

function validatePhone(phone) {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "254" + cleaned.substring(1);
  if (!/^254[17]\d{8}$/.test(cleaned)) throw new Error("Invalid Safaricom phone number");
  return cleaned;
}

function notifyAdmins(message, opts = {}) {
  ADMIN_IDS.forEach((id) => safeSendMessage(id, message, { parse_mode: "Markdown", ...opts }));
}

function getPlanDurationMs(planLabel) {
  const days = PLAN_DAYS[planLabel];
  if (!days) return null;
  if (planLabel === "1 Hour")  return 60 * 60 * 1000;
  if (planLabel === "6 Hours") return 6 * 60 * 60 * 1000;
  return days * 24 * 60 * 60 * 1000;
}

function getPlanHumanTime(planLabel) {
  const map = {
    "1 Hour":   "1 hour",
    "6 Hours":  "6 hours",
    "1 Day":    "1 day",
    "1 Week":   "1 week",
    "2 Weeks":  "2 weeks",
    "1 Month":  "1 month",
    "6 Months": "6 months",
    "1 Year":   "1 year",
  };
  return map[planLabel] || planLabel;
}

// ─── KEYBOARD BUILDERS ────────────────────────────────────────────────────────
function mainPackageKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔥 Premium — Top Rare Contents & Leaks", callback_data: "package_premium" }],
      [{ text: "💥 Explicit — With Free Hookups",        callback_data: "package_explicit" }],
      [{ text: "✈️ I'm Abroad — Can't Use M-Pesa",       callback_data: "abroad_payment" }],
    ]
  };
}

function premiumKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "⏱ 1 Hour    — Ksh 30",   callback_data: "premium_1hour" }],
      [{ text: "⏱ 6 Hours   — Ksh 70",   callback_data: "premium_6hours" }],
      [{ text: "📅 1 Day     — Ksh 100",  callback_data: "premium_1day" }],
      [{ text: "📅 1 Week    — Ksh 220",  callback_data: "premium_1week" }],
      [{ text: "📅 2 Weeks   — Ksh 400",  callback_data: "premium_2weeks" }],
      [{ text: "📅 1 Month   — Ksh 680",  callback_data: "premium_1month" }],
      [{ text: "📅 6 Months  — Ksh 3500", callback_data: "premium_6months" }],
      [{ text: "📅 1 Year    — Ksh 7000", callback_data: "premium_1year" }],
      [{ text: "◀️ Back",                 callback_data: "back_to_packages" }],
    ]
  };
}

function explicitKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "⏱ 1 Hour    — Ksh 40",   callback_data: "explicit_1hour" }],
      [{ text: "⏱ 6 Hours   — Ksh 80",   callback_data: "explicit_6hours" }],
      [{ text: "📅 1 Day     — Ksh 130",  callback_data: "explicit_1day" }],
      [{ text: "📅 1 Week    — Ksh 190",  callback_data: "explicit_1week" }],
      [{ text: "📅 2 Weeks   — Ksh 300",  callback_data: "explicit_2weeks" }],
      [{ text: "📅 1 Month   — Ksh 450",  callback_data: "explicit_1month" }],
      [{ text: "📅 6 Months  — Ksh 2500", callback_data: "explicit_6months" }],
      [{ text: "📅 1 Year    — Ksh 6200", callback_data: "explicit_1year" }],
      [{ text: "◀️ Back",                 callback_data: "back_to_packages" }],
    ]
  };
}

// ─── UPDATED PAYMENT KEYBOARD — direct pay to number, no STK ─────────────────
function paymentKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📲 Pay via M-Pesa (Send Money)",         callback_data: "pay_manual_mpesa" }],
      [{ text: "✈️ I'm Abroad — Crypto Payment",          callback_data: "abroad_payment" }],
      [{ text: "◀️ Back",                                 callback_data: "back_to_packages" }],
    ]
  };
}

function afterPaymentKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✅ I Have Sent Payment — Submit Code", callback_data: "show_manual_code_entry" }],
      [{ text: "💬 Chat with Support",                 url: `https://t.me/Naughtychatsupport` }],
    ]
  };
}

function renewalKeyboard() {
  return {
    inline_keyboard: [[{ text: "🔄 Resubscribe Now", callback_data: "change_package" }]]
  };
}

// ─── REMOVE USER FROM CHANNEL ─────────────────────────────────────────────────
async function removeUserFromChannel(chatId, reason = "") {
  console.log(`🔴 REMOVING USER ${chatId} — Reason: ${reason}`);
  try {
    await bot.banChatMember(CHANNEL_ID, Number(chatId));
    await new Promise(r => setTimeout(r, 1000));
    await bot.unbanChatMember(CHANNEL_ID, Number(chatId));

    if (userInviteLinks[chatId]) {
      try { await bot.revokeChatInviteLink(CHANNEL_ID, userInviteLinks[chatId]); } catch (_) {}
      delete userInviteLinks[chatId];
    }
    console.log(`✅ Removed user ${chatId}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to remove ${chatId}:`, err.message);
    try {
      await bot.kickChatMember(CHANNEL_ID, Number(chatId));
      await new Promise(r => setTimeout(r, 1000));
      await bot.unbanChatMember(CHANNEL_ID, Number(chatId));
      return true;
    } catch (kickErr) {
      console.error(`   Kick also failed:`, kickErr.message);
      return false;
    }
  }
}

async function revokeUserInviteLink(chatId, inviteLinkId) {
  if (!inviteLinkId) return;
  try { await bot.revokeChatInviteLink(CHANNEL_ID, inviteLinkId); }
  catch (err) { console.error(`❌ Revoke link failed:`, err.message); }
}

// ─── GRANT ACCESS ─────────────────────────────────────────────────────────────
async function grantAccess(rawChatId, planLabel, paymentSummary, isManualApproval = false) {
  const chatId = cid(rawChatId);
  console.log(`🔍 grantAccess: chatId=${chatId}, plan="${planLabel}"`);

  const numericId = Number(chatId);
  if (!chatId || isNaN(numericId) || numericId <= 0 || numericId > 9_999_999_999) {
    console.error(`❌ grantAccess rejected — invalid chatId: ${chatId}`);
    notifyAdmins(
      `⚠️ *PAYMENT RECEIVED — BAD CHAT ID*\n\n` +
      `🆔 *Stored chatId:* \`${chatId}\` _(invalid)_\n` +
      `📦 *Plan:* ${planLabel}\n\n` +
      `Ask the customer to send /start to the bot, then run:\n` +
      `/grant <their_id> "${planLabel}"`
    );
    return;
  }

  if (accessAttempts[chatId]) {
    console.log(`⚠️ Already granting for ${chatId}`);
    return;
  }
  accessAttempts[chatId] = true;
  setTimeout(() => { delete accessAttempts[chatId]; }, 10000);

  const resolvedLabel = PLAN_DAYS[planLabel] !== undefined ? planLabel : "1 Month";
  const durationMs = getPlanDurationMs(resolvedLabel);

  if (!durationMs) {
    console.error(`❌ Could not resolve duration for "${planLabel}"`);
    delete accessAttempts[chatId];
    return;
  }

  const sel = userSelections[chatId] || {};
  const username = sel.username || `User ${chatId}`;
  const pkg = sel.package || "Premium";

  try {
    clearSubTimers(chatId);

    try {
      const member = await bot.getChatMember(CHANNEL_ID, Number(chatId));
      if (member.status !== "left" && member.status !== "kicked") {
        await removeUserFromChannel(chatId, "pre-clean for new subscription");
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (_) {}

    const expiresAtMs = Date.now() + durationMs;

    // ── LOADING STATE 1: Notify user we are processing ──────────────────────
    try {
      await bot.sendChatAction(cid(chatId), "typing");
      await safeSendMessage(chatId, `⏳ _Processing your payment…_`, { parse_mode: "Markdown" });
      await new Promise(r => setTimeout(r, 1200));
      await bot.sendChatAction(cid(chatId), "typing");
      await safeSendMessage(chatId, `🔄 _Verifying transaction…_`, { parse_mode: "Markdown" });
      await new Promise(r => setTimeout(r, 1200));
      await bot.sendChatAction(cid(chatId), "typing");
      await safeSendMessage(chatId, `🔐 _Generating your exclusive access link…_`, { parse_mode: "Markdown" });
      await new Promise(r => setTimeout(r, 900));
    } catch (_) {}

    let inviteRes;
    try {
      inviteRes = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date:  Math.floor(expiresAtMs / 1000),
        name:         `Sub-${chatId}-${Date.now()}`,
      });
    } catch (inviteErr) {
      console.error(`❌ createChatInviteLink failed for ${chatId}: ${inviteErr.message}`);
      notifyAdmins(
        `⚠️ *INVITE LINK CREATION FAILED*\n\n` +
        `🆔 *Chat ID:* \`${chatId}\\n` +
        `📦 *Plan:* ${resolvedLabel}\n` +
        `❌ *Error:* ${inviteErr.message}\n\n` +
        `💡 Manually grant with: /grant ${chatId} "${resolvedLabel}"`
      );
      delete accessAttempts[chatId];
      return;
    }
    const inviteLink   = inviteRes.invite_link;
    const inviteLinkId = inviteRes.invite_link_id;
    userInviteLinks[chatId] = inviteLinkId;

    let planNote = "";
    if (resolvedLabel === "1 Hour") {
      planNote = `\n\n💬 _Many users enjoy the 1-hour experience — it's just the right taste!_\n_Whenever you're ready to extend, we'll be right here. No pressure_ 😊`;
    }

    // ── APPROVAL NOTICE (manual approvals only) ───────────────────────────
    if (isManualApproval) {
      try {
        await safeSendMessage(chatId,
          `✅ _Sorry for the delay — Admin has already approved your request._\n\n` +
          `_If you experienced a delay, it's because the admin has too many requests to approve, but we value our customers and every request is handled with care._ 🙏`,
          { parse_mode: "Markdown" }
        );
        await new Promise(r => setTimeout(r, 800));
      } catch (_) {}
    }

    // ─── LINK DELIVERY WITH RETRY ──────────────────────────────────────────
    const MAX_DELIVERY_RETRIES = 5;
    let deliverySuccess = false;
    let lastDeliveryError = null;

    for (let attempt = 1; attempt <= MAX_DELIVERY_RETRIES; attempt++) {
      try {
        await sendWithTyping(chatId,
          `🎉 *Access Granted!*\n\n${paymentSummary}\n\n` +
          `👇 *Tap below to join — link is single-use:*\n${inviteLink}\n\n` +
          `⚠️ You'll be automatically removed after *${getPlanHumanTime(resolvedLabel)}*` +
          planNote,
          { disable_web_page_preview: false }
        );
        deliverySuccess = true;
        break;
      } catch (deliveryErr) {
        lastDeliveryError = deliveryErr;
        console.warn(`⚠️ Link delivery attempt ${attempt}/${MAX_DELIVERY_RETRIES} failed for ${chatId}: ${deliveryErr.message}`);
        if (attempt < MAX_DELIVERY_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }

    if (!deliverySuccess) {
      try {
        await bot.sendMessage(chatId,
          `⚠️ *We're experiencing a technical issue.*\n\n` +
          `Don't worry — your payment has been received and your access is confirmed.\n\n` +
          `Our team has been notified and you will be compensated. We're sorry for the inconvenience! 🙏`,
          { parse_mode: "Markdown" }
        );
      } catch (_) {}

      const sel2 = userSelections[chatId] || {};
      const adminAlertMsg =
        `⚠️ *LINK DELIVERY FAILURE ALERT*\n\n` +
        `User has *NOT received the link* after ${MAX_DELIVERY_RETRIES} retries.\n\n` +
        `🆔 *Chat ID:* \`${chatId}\\n` +
        `👤 *Username:* ${sel2.username || `User ${chatId}`}\n` +
        `📦 *Package:* ${sel2.package || pkg} — ${resolvedLabel}\n` +
        `🔗 *Invite Link:* ${inviteLink}\n\n` +
        `💡 *Action:* /apology ${chatId} ${resolvedLabel}`;

      try {
        await bot.sendMessage("6954749470", adminAlertMsg, { parse_mode: "Markdown" });
      } catch (_) { notifyAdmins(adminAlertMsg); }
    }

    // ─── EXPIRY TIMER ──────────────────────────────────────────────────────
    const kickTimer = setTimeout(async () => {
      console.log(`🔴 EXPIRY: ${chatId}`);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await removeUserFromChannel(chatId, `EXPIRED: ${resolvedLabel} (attempt ${attempt})`);
        if (result) break;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }

      await revokeUserInviteLink(chatId, inviteLinkId);

      await sendWithTyping(chatId,
        `Hello Naughty254 user, your sweet time with us just expired ⏳😉\n\n` +
        `Your *${resolvedLabel}* access has ended.\n\n` +
        `Ready for more content? Tap below to resubscribe and catch up on the latest videos, exposes and hook-ups.`,
        renewalKeyboard()
      );

      delete subTimers[chatId];
      removeSubEntry(chatId);
      await db.deleteSubscription(chatId);
      delete userInviteLinks[chatId];
    }, durationMs);

    // ─── 24-HOUR WARNING TIMER ─────────────────────────────────────────────
    let warnTimer = null;
    const shortPlans = ["1 Hour", "6 Hours", "1 Day"];
    if (!shortPlans.includes(resolvedLabel) && durationMs > warnMs) {
      warnTimer = setTimeout(() => {
        sendWithTyping(chatId,
          `⏰ *Heads up!*\n\nYour *${resolvedLabel}* subscription expires in *24 hours*.\n\nRenew now to keep the vibes going! 🔥`,
          { reply_markup: { inline_keyboard: [[{ text: "🔄 Renew Now", callback_data: "change_package" }]] } }
        );
      }, durationMs - warnMs);
    }

    subTimers[chatId] = { expiresAt: expiresAtMs, kickTimer, warnTimer, inviteLinkId, plan: resolvedLabel };

    saveSubEntry(chatId, resolvedLabel, expiresAtMs, username, inviteLink, inviteLinkId, pkg);
    await db.saveSubscription(chatId, resolvedLabel, pkg, sel.price, expiresAtMs, inviteLink, inviteLinkId, sel.stkRef || null, username);

    console.log(`✅ Access granted for ${chatId} — expires ${new Date(expiresAtMs).toLocaleString()}`);
    delete accessAttempts[chatId];
    if (isManualApproval) delete pendingManualApprovals[chatId];

  } catch (err) {
    console.error("❌ grantAccess error:", err.message, err.stack);
    await safeSendMessage(chatId,
      `✅ *Payment received!*\n\nWe're having a small technical issue. Admin has been notified and will send your access link within 5 minutes.`
    );
    notifyAdmins(
      `⚠️ *Auto-invite FAILED for* \`${chatId}\`\nPlan: ${planLabel}\nError: ${err.message}\n\nUse: /grant ${chatId} "${planLabel}"`
    );
    delete accessAttempts[chatId];
  }
}

function clearSubTimers(chatId) {
  const id = cid(chatId);
  if (subTimers[id]) {
    if (subTimers[id].kickTimer) clearTimeout(subTimers[id].kickTimer);
    if (subTimers[id].warnTimer) clearTimeout(subTimers[id].warnTimer);
    delete subTimers[id];
    removeSubEntry(id);
  }
}

// ─── M-PESA CALLBACK (kept for future STK use) ───────────────────────────────
app.post("/mpesa/callback", (req, res) => {
  console.log("📩 MPESA CALLBACK RECEIVED:", JSON.stringify(req.body));
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const body = req.body?.Body?.stkCallback;
    const checkId = body?.CheckoutRequestID;
    const pending = pendingSTK[checkId];
    if (!pending) return;

    delete pendingSTK[checkId];
    savePendingSTK(pendingSTK);

    if (body?.ResultCode === 0) {
      const meta = body.CallbackMetadata?.Item || [];
      const get = (name) => meta.find(i => i.Name === name)?.Value ?? "—";
      const amount = get("Amount");
      const mpesaCode = get("MpesaReceiptNumber");

      const sel = userSelections[pending.chatId] || {};
      sel.paidAt = new Date().toISOString();
      sel.stkRef = mpesaCode;
      sel.plan    = sel.plan    || pending.plan;
      sel.package = sel.package || pending.pkg;
      sel.price   = sel.price   || pending.price;
      userSelections[pending.chatId] = sel;
      saveUserSelection(pending.chatId, sel);

      grantAccess(pending.chatId, pending.plan || sel.plan || "1 Month", `✅ Ksh ${amount} received\nRef: ${mpesaCode}`);
      notifyAdmins(`💰 Payment: ${pending.chatId} | Ksh ${amount} | ${mpesaCode}`);
    }
  } catch (err) {
    console.error("Callback error:", err.message);
  }
});

// ─── RESTORE SUBS ON STARTUP ──────────────────────────────────────────────────
async function restoreActiveSubscriptions() {
  const subs = loadSubs();
  const now  = Date.now();
  console.log(`🔄 Restoring ${Object.keys(subs).length} JSON subscriptions...`);

  for (const [chatId, sub] of Object.entries(subs)) {
    if (sub.expiresAt > now) {
      const remainingMs = sub.expiresAt - now;
      const kickTimer = setTimeout(async () => {
        console.log(`🔴 EXPIRED (restored): ${chatId}`);
        await removeUserFromChannel(chatId, `EXPIRED: ${sub.planLabel}`);
        if (sub.inviteLinkId) await revokeUserInviteLink(chatId, sub.inviteLinkId);

        await sendWithTyping(chatId,
          `Hello Naughty254 user, your sweet time with us just expired ⏳😉\n\n` +
          `Your *${sub.planLabel}* access has ended.\n\n` +
          `Ready for more content? Tap below to resubscribe and catch up on the latest videos, exposes and hook-ups.`,
          renewalKeyboard()
        );

        delete subTimers[chatId];
        removeSubEntry(chatId);
        await db.deleteSubscription(chatId);
      }, remainingMs);

      subTimers[chatId] = { expiresAt: sub.expiresAt, kickTimer, inviteLinkId: sub.inviteLinkId, plan: sub.planLabel };
      if (sub.inviteLinkId) userInviteLinks[chatId] = sub.inviteLinkId;
    } else {
      removeSubEntry(chatId);
      await removeUserFromChannel(chatId, "expired on startup");
      await db.deleteSubscription(chatId);
    }
  }
  console.log(`✅ Restored ${Object.keys(subTimers).length} active subscriptions`);
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId   = cid(msg.from.id);
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || `User`;

  userSelections[chatId] = { username, freshStart: true };
  saveUserSelection(chatId, userSelections[chatId]);

  db.upsertUser(chatId, username).catch(err => console.error("DB upsert:", err.message));

  try {
    await bot.sendChatAction(cid(chatId), "typing");
    await new Promise(r => setTimeout(r, 700));
  } catch (_) {}

  await safeSendMessage(chatId,
    `🔥 *Welcome ${username}!*\n\n` +
    `You've just unlocked the door to *exclusive content* 🎬\n\n` +
    `Premium leaks • Explicit content • Free hookup connections\n\n` +
    `👇 *Choose your package to get started:*`,
    { reply_markup: mainPackageKeyboard() }
  );
});

// ─── UTILITY COMMANDS ─────────────────────────────────────────────────────────
bot.onText(/\/myid/, (msg) => {
  safeSendMessage(cid(msg.chat.id), `🆔 Your ID: \`${msg.chat.id}\``);
});

// ─── ADMIN: /grant ─────────────────────────────────────────────────────────────
bot.onText(/\/grant (\d+)(?: (.+))?/, async (msg, match) => {
  if (!ADMIN_IDS.includes(cid(msg.chat.id))) return;
  const targetId  = match[1];
  const rawPlan   = (match[2] || "").trim();

  const validPlan = Object.keys(PLAN_DAYS).find(
    p => p.toLowerCase() === rawPlan.toLowerCase()
  ) || (rawPlan === "" ? "1 Month" : null);

  if (!validPlan) {
    return safeSendMessage(cid(msg.chat.id),
      `⚠️ Unknown plan: *"${rawPlan}"*\n\nValid plans:\n${Object.keys(PLAN_DAYS).map(p => `• ${p}`).join("\n")}`
    );
  }

  await grantAccess(targetId, validPlan, `✅ Admin granted (${validPlan})`);
  safeSendMessage(cid(msg.chat.id), `✅ Granted *${validPlan}* to \`${targetId}\``);
});

// ─── ADMIN: /remove ────────────────────────────────────────────────────────────
bot.onText(/\/remove (\d+)/, async (msg, match) => {
  if (!ADMIN_IDS.includes(cid(msg.chat.id))) return;
  await removeUserFromChannel(match[1], "admin command");
  clearSubTimers(match[1]);
  await db.deleteSubscription(match[1]);
  safeSendMessage(cid(msg.chat.id), `✅ Removed ${match[1]}`);
});

// ─── ADMIN: /listsubs ──────────────────────────────────────────────────────────
bot.onText(/\/listsubs/, async (msg) => {
  if (!ADMIN_IDS.includes(cid(msg.chat.id))) return;
  const subs = loadSubs();
  let text = "*Active Subscriptions:*\n";
  for (const [id, sub] of Object.entries(subs)) {
    if (sub.expiresAt > Date.now()) {
      text += `• \`${id}\` — ${sub.planLabel} — expires ${new Date(sub.expiresAt).toLocaleString()}\n`;
    }
  }
  safeSendMessage(cid(msg.chat.id), text || "No active subscriptions.");
});

// ─── ADMIN: /approve & /deny — MANUAL APPROVAL ────────────────────────────────
bot.onText(/\/approve (\d+)/, async (msg, match) => {
  if (!ADMIN_IDS.includes(cid(msg.chat.id))) return;
  const targetId = match[1];
  const pending  = pendingManualApprovals[targetId];
  if (!pending) return safeSendMessage(cid(msg.chat.id), `⚠️ No pending approval for ${targetId}`);
  await grantAccess(targetId, pending.plan, `✅ Admin approved\nKsh ${pending.price} | Code: \`${pending.code}\``, true);
  safeSendMessage(cid(msg.chat.id), `✅ Approved & granted to ${targetId}`);
});

bot.onText(/\/deny (\d+)/, async (msg, match) => {
  if (!ADMIN_IDS.includes(cid(msg.chat.id))) return;
  const targetId = match[1];
  const pending  = pendingManualApprovals[targetId];
  if (pending) {
    delete pendingManualApprovals[targetId];
    await safeSendMessage(targetId,
      `❌ Payment code \`${pending.code}\` could not be verified.\n\nPlease double-check and try again or contact ${ADMIN_USERNAME}.`
    );
  }
  safeSendMessage(cid(msg.chat.id), `✅ Denied ${targetId}`);
});

// ─── ADMIN: /broadcast_paid ───────────────────────────────────────────────────
bot.onText(/\/broadcast_paid/, async (msg) => {
  const chatId = cid(msg.chat.id);
  if (!ADMIN_IDS.includes(chatId)) return;

  broadcastState[chatId] = { step: "headline" };
  await sendWithTyping(chatId,
    `📢 *Broadcast to Paid Users*\n\nStep 1 of 2: Enter the *message headline*\n_(e.g. "Alicia Kanini New Leak 🔥")_`
  );
});

// ─── ADMIN: /apology ──────────────────────────────────────────────────────────
bot.onText(/\/apology(?:\s+(\d+)(?:\s+(.+))?)?/, async (msg, match) => {
  const adminChatId = cid(msg.chat.id);
  if (!ADMIN_IDS.includes(adminChatId)) return;

  if (!match[1]) {
    return safeSendMessage(adminChatId,
      `📋 *How to use /apology:*\n\n` +
      `Command format:\n` +
      `\`/apology <chat_id> <plan>\`\n\n` +
      `*Examples:*\n` +
      `• \`/apology 123456789 1 Hour\`\n` +
      `• \`/apology 123456789 1 Day\`\n` +
      `• \`/apology 123456789 1 Week\`\n` +
      `• \`/apology 123456789 1 Month\`\n\n` +
      `*Available plans:* 1 Hour, 6 Hours, 1 Day, 1 Week, 2 Weeks, 1 Month, 6 Months, 1 Year`
    );
  }

  const targetChatId = match[1];
  const planLabel    = match[2] ? match[2].trim() : "1 Month";
  const normalisedPlan = Object.keys(PLAN_DAYS).find(
    k => k.toLowerCase() === planLabel.toLowerCase()
  ) || planLabel;

  if (!PLAN_DAYS[normalisedPlan]) {
    return safeSendMessage(adminChatId,
      `⚠️ Unknown plan: *${planLabel}*\n\nAvailable plans: ${Object.keys(PLAN_DAYS).join(", ")}`
    );
  }

  const targetSel = userSelections[targetChatId] || loadUserSelections()[targetChatId] || {};
  const targetPkg = targetSel.package || "Premium";

  apologyState[adminChatId] = {
    step: "awaiting_message",
    targetChatId,
    plan: normalisedPlan,
    pkg:  targetPkg,
  };

  await safeSendMessage(adminChatId,
    `✉️ *Apology to:* \`${targetChatId}\`\n` +
    `📦 *Package:* ${targetPkg} — ${normalisedPlan}\n\n` +
    `What message would you like to send to this user?`
  );
});

// ─── CALLBACK QUERY HANDLER ───────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const chatId = cid(query.from.id);
  const data   = query.data;
  bot.answerCallbackQuery(query.id).catch(() => {});

  // ── BACK ───────────────────────────────────────────────────────────────────
  if (data === "back_to_packages") {
    return sendWithTyping(chatId, `👇 *Choose your package:*`, { reply_markup: mainPackageKeyboard() });
  }

  // ── PACKAGE SELECTION ──────────────────────────────────────────────────────
  if (data === "package_premium") {
    userSelections[chatId] = { ...userSelections[chatId], package: "Premium" };
    saveUserSelection(chatId, userSelections[chatId]);
    return sendWithTyping(chatId,
      `🔥 *Premium Package*\n_Top rare contents & exclusive leaks_\n\nSelect your plan:`,
      { reply_markup: premiumKeyboard() }
    );
  }

  if (data === "package_explicit") {
    userSelections[chatId] = { ...userSelections[chatId], package: "Explicit" };
    saveUserSelection(chatId, userSelections[chatId]);
    return sendWithTyping(chatId,
      `💥 *Explicit Package*\n_Raw content + free hookup connections_\n\nSelect your plan:`,
      { reply_markup: explicitKeyboard() }
    );
  }

  // ── PLAN SELECTION ─────────────────────────────────────────────────────────
  if (PLANS[data]) {
    const plan = PLANS[data];
    userSelections[chatId] = {
      ...userSelections[chatId],
      plan:    plan.label,
      price:   plan.price,
      package: plan.pkg,
    };
    saveUserSelection(chatId, userSelections[chatId]);

    return sendWithTyping(chatId,
      `✅ *${plan.pkg} — ${plan.label}*\n💰 Ksh *${plan.price}*\n\nHow would you like to pay?`,
      { reply_markup: paymentKeyboard() }
    );
  }

  // ── PAY VIA MPESA — DIRECT SEND MONEY ─────────────────────────────────────
  if (data === "pay_manual_mpesa") {
    const sel = userSelections[chatId];
    if (!sel?.price) return sendWithTyping(chatId, `⚠️ Please select a package first. Tap /start`);

    return sendWithTyping(chatId,
      `💳 *Payment Instructions*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📲 *Send Money via M-Pesa*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `1️⃣  Open *M-Pesa* on your phone\n` +
      `2️⃣  Select *Send Money*\n` +
      `3️⃣  Enter number: *${PAYBILL_NUMBER}*\n` +
      `4️⃣  Enter amount: *Ksh ${sel.price}*\n` +
      `5️⃣  Name will show as: *${PAYBILL_NAME}* ✅\n` +
      `6️⃣  Enter your M-Pesa PIN & confirm\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ *Important:* Send *exactly Ksh ${sel.price}* to avoid delays.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ Once sent, tap the button below and enter your M-Pesa confirmation code.\n\n` +
      `_Example codes: RCX4B2K9QP, QGH8J1N2WA_`,
      { reply_markup: afterPaymentKeyboard() }
    );
  }

  // ── ABROAD / CRYPTO ────────────────────────────────────────────────────────
  if (data === "abroad_payment") {
    userSelections[chatId] = { ...userSelections[chatId], paymentMethod: "crypto" };
    saveUserSelection(chatId, userSelections[chatId]);
    return sendWithTyping(chatId,
      `🌍 *International Crypto Packages (USDT)*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Premium* _(Top rare contents & leaks)_\n` +
      `• 1 Day — $7\n• 1 Week — $15\n• 2 Weeks — $25\n• 1 Month — $40\n• 3 Months — $65\n• 6 Months — $100\n• 1 Year — $250\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💥 *Explicit Package* _(With Free Hook-up)_\n` +
      `• 1 Week — $12\n• 2 Weeks — $25\n• 1 Month — $60\n• 3 Months — $95\n• 6 Months — $150\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👇 *Select your package:*`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔥 Premium Crypto Packages",  callback_data: "crypto_premium" }],
            [{ text: "💥 Explicit Crypto Packages",  callback_data: "crypto_explicit" }],
            [{ text: "◀️ Back",                      callback_data: "back_to_packages" }],
          ]
        }
      }
    );
  }

  if (data === "crypto_premium") {
    userSelections[chatId] = { ...userSelections[chatId], package: "Premium", paymentMethod: "crypto" };
    saveUserSelection(chatId, userSelections[chatId]);
    return sendWithTyping(chatId, `🔥 *Premium Crypto — Select Plan:*`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 1 Day     — $7",    callback_data: "crypto_plan_premium_1day" }],
          [{ text: "📅 1 Week    — $15",   callback_data: "crypto_plan_premium_1week" }],
          [{ text: "📅 2 Weeks   — $25",   callback_data: "crypto_plan_premium_2weeks" }],
          [{ text: "📅 1 Month   — $40",   callback_data: "crypto_plan_premium_1month" }],
          [{ text: "📅 3 Months  — $65",   callback_data: "crypto_plan_premium_3months" }],
          [{ text: "📅 6 Months  — $100",  callback_data: "crypto_plan_premium_6months" }],
          [{ text: "📅 1 Year    — $250",  callback_data: "crypto_plan_premium_1year" }],
          [{ text: "◀️ Back",              callback_data: "abroad_payment" }],
        ]
      }
    });
  }

  if (data === "crypto_explicit") {
    userSelections[chatId] = { ...userSelections[chatId], package: "Explicit", paymentMethod: "crypto" };
    saveUserSelection(chatId, userSelections[chatId]);
    return sendWithTyping(chatId, `💥 *Explicit Crypto — Select Plan:*`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 1 Week    — $12",   callback_data: "crypto_plan_explicit_1week" }],
          [{ text: "📅 2 Weeks   — $25",   callback_data: "crypto_plan_explicit_2weeks" }],
          [{ text: "📅 1 Month   — $60",   callback_data: "crypto_plan_explicit_1month" }],
          [{ text: "📅 3 Months  — $95",   callback_data: "crypto_plan_explicit_3months" }],
          [{ text: "📅 6 Months  — $150",  callback_data: "crypto_plan_explicit_6months" }],
          [{ text: "◀️ Back",              callback_data: "abroad_payment" }],
        ]
      }
    });
  }

  const CRYPTO_PLANS = {
    crypto_plan_premium_1day:     { label: "1 Day",     pkg: "Premium",  price: "$7"   },
    crypto_plan_premium_1week:    { label: "1 Week",    pkg: "Premium",  price: "$15"  },
    crypto_plan_premium_2weeks:   { label: "2 Weeks",   pkg: "Premium",  price: "$25"  },
    crypto_plan_premium_1month:   { label: "1 Month",   pkg: "Premium",  price: "$40"  },
    crypto_plan_premium_3months:  { label: "3 Months",  pkg: "Premium",  price: "$65"  },
    crypto_plan_premium_6months:  { label: "6 Months",  pkg: "Premium",  price: "$100" },
    crypto_plan_premium_1year:    { label: "1 Year",    pkg: "Premium",  price: "$250" },
    crypto_plan_explicit_1week:   { label: "1 Week",    pkg: "Explicit", price: "$12"  },
    crypto_plan_explicit_2weeks:  { label: "2 Weeks",   pkg: "Explicit", price: "$25"  },
    crypto_plan_explicit_1month:  { label: "1 Month",   pkg: "Explicit", price: "$60"  },
    crypto_plan_explicit_3months: { label: "3 Months",  pkg: "Explicit", price: "$95"  },
    crypto_plan_explicit_6months: { label: "6 Months",  pkg: "Explicit", price: "$150" },
  };

  if (CRYPTO_PLANS[data]) {
    const cp = CRYPTO_PLANS[data];
    userSelections[chatId] = {
      ...userSelections[chatId],
      plan:    cp.label,
      package: cp.pkg,
      cryptoPrice: cp.price,
      paymentMethod: "crypto",
    };
    saveUserSelection(chatId, userSelections[chatId]);

    return sendWithTyping(chatId,
      `✅ *${cp.pkg} — ${cp.label}* | ${cp.price} USDT\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🌍 *International Payment — USDT Crypto*\n\n` +
      `Send *exactly ${cp.price}* to the address below:\n\n` +
      `🔗 *Network:* USDT TRC20 _(Tron)_\n` +
      `📋 *Address:*\n\`${CRYPTO_ADDRESS}\`\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ *IMPORTANT WARNING* ⚠️\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🚫 Only send *USDT via TRC20 network*.\n` +
      `❌ Wrong network (ERC20, BEP20, etc.) = *permanent loss of funds*.\n` +
      `✅ Double-check the network before confirming.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `After sending, tap *"Confirm Crypto Payment"* and admin will grant access:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Confirm Crypto Payment", url: `https://t.me/Naughtychatsupport?start=confirm_crypto` }],
            [{ text: "💬 Chat with Admin",         url: `https://t.me/Naughtychatsupport` }],
            [{ text: "◀️ Back",                    callback_data: "abroad_payment" }],
          ]
        }
      }
    );
  }

  // ── CHECK MY PAYMENT ───────────────────────────────────────────────────────
  if (data === "check_my_payment") {
    const subData = loadSubs()[chatId];
    if (subData && subData.expiresAt > Date.now() && subData.inviteLink) {
      return sendWithTyping(chatId,
        `🔗 *Here is your access link:*\n\n${subData.inviteLink}\n\n⚠️ This link is single-use. If it no longer works, contact ${ADMIN_USERNAME}.`
      );
    }
    return sendWithTyping(chatId,
      `⚠️ *No active subscription found.*\n\nIf you've already paid, please contact ${ADMIN_USERNAME} with your M-Pesa confirmation code.`
    );
  }

  // ── MANUAL CODE ENTRY ──────────────────────────────────────────────────────
  if (data === "show_manual_code_entry") {
    userSelections[chatId] = { ...userSelections[chatId], awaitingManualCode: true };
    saveUserSelection(chatId, userSelections[chatId]);
    return sendWithTyping(chatId,
      `📝 *Enter your M-Pesa confirmation code*\n\n` +
      `This is the code you received in the SMS from M-Pesa after sending.\n\n` +
      `📌 *Examples:*\n` +
      `• \`RCX4B2K9QP\`\n` +
      `• \`QGH8J1N2WA\`\n` +
      `• \`SFP3K7M5BT\`\n\n` +
      `_It's a 10-character code containing letters and numbers._\n\n` +
      `⏳ _Admin will review and approve your access shortly._`
    );
  }

  // ── ADMIN INLINE APPROVE ───────────────────────────────────────────────────
  if (data.startsWith("admin_approve_")) {
    if (!ADMIN_IDS.includes(chatId)) return;
    const targetId = data.replace("admin_approve_", "");
    const pending  = pendingManualApprovals[targetId];
    if (!pending) {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ Already processed or expired.", show_alert: true }).catch(() => {});
    }
    await grantAccess(targetId, pending.plan, `✅ Admin approved\nKsh ${pending.price} | Code: \`${pending.code}\``, true);
    safeSendMessage(cid(query.message.chat.id), `✅ *Approved & access granted to* \`${targetId}\``);
    return;
  }

  // ── ADMIN INLINE DENY ──────────────────────────────────────────────────────
  if (data.startsWith("admin_deny_")) {
    if (!ADMIN_IDS.includes(chatId)) return;
    const targetId = data.replace("admin_deny_", "");
    const pending  = pendingManualApprovals[targetId];
    if (pending) {
      delete pendingManualApprovals[targetId];
      await safeSendMessage(targetId,
        `❌ Your payment code \`${pending.code}\` could not be verified.\n\nPlease double-check and try again, or contact ${ADMIN_USERNAME}.`
      );
    }
    safeSendMessage(cid(query.message.chat.id), `✅ *Denied & user notified:* \`${targetId}\``);
    return;
  }

  // ── COMPENSATION LINK ─────────────────────────────────────────────────────
  if (data.startsWith("compensation_")) {
    const parts = data.split("_");
    const compChatId = parts[1];

    if (chatId !== compChatId) {
      return bot.answerCallbackQuery(query.id, { text: "This compensation is not for you.", show_alert: true }).catch(() => {});
    }

    const remainingData  = data.slice("compensation_".length + compChatId.length + 1);
    const separatorIndex = remainingData.lastIndexOf("_");
    const encodedPlan    = remainingData.slice(0, separatorIndex);
    const encodedPkg     = remainingData.slice(separatorIndex + 1);
    const compPlan       = decodeURIComponent(encodedPlan);
    const compPkg        = decodeURIComponent(encodedPkg);

    userSelections[chatId] = {
      ...(userSelections[chatId] || {}),
      plan:    compPlan,
      package: compPkg,
      username: userSelections[chatId]?.username || `User ${chatId}`,
    };
    saveUserSelection(chatId, userSelections[chatId]);

    await sendWithTyping(chatId, `⏳ _Generating your compensation link…_`, { parse_mode: "Markdown" });
    await grantAccess(chatId, compPlan, `🎁 *Compensation access granted!*\nPackage: ${compPkg} — ${compPlan}`);
    return;
  }

  // ── CHANGE PACKAGE ─────────────────────────────────────────────────────────
  if (data === "change_package") {
    const username = userSelections[chatId]?.username;
    userSelections[chatId] = { username };
    saveUserSelection(chatId, userSelections[chatId]);
    return sendWithTyping(chatId, `🔄 *Choose your package:*`, { reply_markup: mainPackageKeyboard() });
  }
});

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const chatId = cid(msg.from.id);
  const text   = msg.text.trim();
  const sel    = userSelections[chatId] || {};

  // ── BROADCAST WIZARD ──────────────────────────────────────────────────────
  if (ADMIN_IDS.includes(chatId) && broadcastState[chatId]) {
    const state = broadcastState[chatId];

    if (state.step === "headline") {
      broadcastState[chatId] = { step: "followup", headline: text };
      return sendWithTyping(chatId,
        `📢 Headline saved: *"${text}"*\n\nStep 2 of 2: Enter the *follow-up message*:`
      );
    }

    if (state.step === "followup") {
      const headline = state.headline;
      const followup = text;
      delete broadcastState[chatId];

      const fullMessage = `🔥 *${headline}*\n\n${followup}\n\n_— Naughty254_`;

      await sendWithTyping(chatId, `⏳ Sending broadcast to all users...`);

      const allUsers = await db.getAllUsers();
      let sent = 0, failed = 0;

      for (const uid of allUsers) {
        try {
          await bot.sendMessage(uid, fullMessage, { parse_mode: "Markdown" });
          await db.logBroadcast(uid, fullMessage);
          sent++;
          await new Promise(r => setTimeout(r, 50));
        } catch (_) { failed++; }
      }

      return sendWithTyping(chatId,
        `✅ *Broadcast complete!*\n\n📤 Sent: ${sent}\n❌ Failed: ${failed}`
      );
    }
  }

  // ── APOLOGY WIZARD ────────────────────────────────────────────────────────
  if (ADMIN_IDS.includes(chatId) && apologyState[chatId]) {
    const aState = apologyState[chatId];

    if (aState.step === "awaiting_message") {
      const apologyMsg = text;
      delete apologyState[chatId];

      const compensationData = `compensation_${aState.targetChatId}_${encodeURIComponent(aState.plan)}_${encodeURIComponent(aState.pkg)}`;

      try {
        await bot.sendMessage(aState.targetChatId, apologyMsg, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "🎁 Click Here To Get Compensation Link", callback_data: compensationData }
            ]]
          }
        });
        await safeSendMessage(chatId,
          `✅ *Apology message sent to* \`${aState.targetChatId}\`\n\nThe user will see a button to claim their compensation link.`
        );
      } catch (err) {
        await safeSendMessage(chatId,
          `❌ Failed to send message to \`${aState.targetChatId}\`: ${err.message}`
        );
      }
    }
    return;
  }

  // ── MANUAL MPESA CODE ─────────────────────────────────────────────────────
  if (sel.awaitingManualCode && /^[A-Z0-9]{10}$/i.test(text)) {
    userSelections[chatId].awaitingManualCode = false;
    const code = text.toUpperCase();
    saveUserSelection(chatId, userSelections[chatId]);

    pendingManualApprovals[chatId] = {
      plan:      sel.plan,
      price:     sel.price,
      code,
      package:   sel.package,
      username:  sel.username,
      timestamp: Date.now(),
    };

    // ── Notify user with loading states ─────────────────────────────────────
    await sendWithTyping(chatId, `⏳ _Processing payment…_`, { parse_mode: "Markdown" });
    await new Promise(r => setTimeout(r, 1000));
    await sendWithTyping(chatId, `🔄 _Verifying transaction…_`, { parse_mode: "Markdown" });
    await new Promise(r => setTimeout(r, 1000));

    await sendWithTyping(chatId,
      `✅ *Code Received Successfully!*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *M-Pesa Code:* \`${code}\`\n` +
      `💰 *Amount:* Ksh ${sel.price}\n` +
      `📦 *Package:* ${sel.package} — ${sel.plan}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🔍 Your payment is being reviewed by our admin team.\n\n` +
      `_Approvals are typically completed within 2–5 minutes. We appreciate your patience!_ 🙏`
    );

    // ── Notify admins with inline Approve / Deny buttons ──────────────────
    const adminMsg =
      `🔔 *NEW MANUAL PAYMENT REQUEST*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *User:* \`${chatId}\`\n` +
      `📛 *Username:* ${sel.username || "Unknown"}\n` +
      `📦 *Package:* ${sel.package} — ${sel.plan}\n` +
      `💰 *Amount:* Ksh ${sel.price}\n` +
      `📋 *M-Pesa Code:* \`${code}\`\n` +
      `🕐 *Time:* ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Tap a button below to approve or deny this request:`;

    const adminKeyboard = {
      inline_keyboard: [[
        { text: "✅ Approve & Grant Access", callback_data: `admin_approve_${chatId}` },
        { text: "❌ Deny",                   callback_data: `admin_deny_${chatId}` },
      ]]
    };

    ADMIN_IDS.forEach(id => {
      bot.sendMessage(id, adminMsg, { parse_mode: "Markdown", reply_markup: adminKeyboard }).catch(() => {});
    });
    return;
  }

  // ── ACTIVE SUBSCRIPTION CHECK ──────────────────────────────────────────────
  const subData = loadSubs()[chatId];
  if (subData && subData.expiresAt > Date.now()) {
    const remainingMs  = subData.expiresAt - Date.now();
    const remainingHrs = Math.ceil(remainingMs / (1000 * 60 * 60));
    await sendWithTyping(chatId,
      `✨ *You're all set!*\n\n*${subData.planLabel}* — ${remainingHrs} hour(s) remaining.\n\nWant to extend?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬆️ Upgrade / Extend",                    callback_data: "change_package" }],
            [{ text: "🔗 Resend My Access Link",                callback_data: "check_my_payment" }],
          ]
        }
      }
    );
    return;
  }

  await sendWithTyping(chatId, `🎬 Ready to dive in? Tap /start to subscribe!`);
});

// ─── RE-ENGAGEMENT ────────────────────────────────────────────────────────────
async function sendReEngagement() {
  const messages = [
    `👀 *Still thinking about it?*\n\nExclusive content is waiting for you — don't miss out!\n\n👇 Tap below to subscribe:`,
    `🔥 *New content just dropped!*\n\nJoin thousands of members enjoying fresh leaks and exclusive videos.\n\n👇 Get access now:`,
  ];

  const unpaidUsers = await db.getAllUnpaidUsers();

  for (const chatId of unpaidUsers) {
    try {
      const countToday = await db.getEngagementCountToday(chatId);
      if (countToday >= 2) continue;

      const msg = messages[countToday % messages.length];
      await bot.sendMessage(chatId, msg, {
        parse_mode:   "Markdown",
        reply_markup: mainPackageKeyboard(),
      });
      await db.logEngagement(chatId, msg);
      await new Promise(r => setTimeout(r, 100));
    } catch (_) {}
  }
}

setInterval(sendReEngagement, 12 * 60 * 60 * 1000);

// ─── MONITOR TIMERS ───────────────────────────────────────────────────────────
setInterval(() => {
  for (const [chatId, timer] of Object.entries(subTimers)) {
    const remaining = timer.expiresAt - Date.now();
    if (remaining > 0 && remaining < 60000) {
      console.log(`⚠️ Timer for ${chatId} expires in ${Math.floor(remaining / 1000)}s`);
    }
  }
}, 10000);

// ─── STATUS ENDPOINT ──────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({
    status:                  "online",
    activeSubscriptions:     Object.keys(subTimers).length,
    persistedSubscriptions:  Object.keys(loadSubs()).length,
    timestamp:               new Date().toISOString(),
  });
});

// ─── STARTUP ──────────────────────────────────────────────────────────────────
async function startup() {
  await db.initDB();
  await restoreActiveSubscriptions();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📺 Channel: ${CHANNEL_ID}`);
    console.log(`🔐 Auto-removal: ACTIVE`);
    console.log(`💾 PostgreSQL: CONNECTED`);
    console.log(`💳 Payment: Send Money to ${PAYBILL_NUMBER} (${PAYBILL_NAME})`);
  });
}

startup().catch(err => {
  console.error("❌ Startup failed:", err.message);
  process.exit(1);
});
