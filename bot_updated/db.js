/**
 * db.js — Supabase database module (CLEAN VERSION)
 * Replaces PostgreSQL completely
 */

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─────────────────────────────────────────────
// INIT (Supabase does NOT require table creation in code)
// ─────────────────────────────────────────────
async function initDB() {
  console.log("✅ Supabase connected successfully (no init required)");
}

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────
async function upsertUser(chatId, username) {
  const { error } = await supabase.from("users").upsert(
    {
      chat_id: String(chatId),
      username: username || String(chatId),
      last_active: new Date()
    },
    {
      onConflict: "chat_id"
    }
  );

  if (error) console.error("❌ upsertUser:", error.message);
}

async function markUserPaid(chatId) {
  const { error } = await supabase
    .from("users")
    .update({ is_paid: true, last_active: new Date() })
    .eq("chat_id", String(chatId));

  if (error) console.error("❌ markUserPaid:", error.message);
}

async function markUserUnpaid(chatId) {
  const { error } = await supabase
    .from("users")
    .update({ is_paid: false })
    .eq("chat_id", String(chatId));

  if (error) console.error("❌ markUserUnpaid:", error.message);
}

async function getAllPaidUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("chat_id")
    .eq("is_paid", true);

  if (error) {
    console.error("❌ getAllPaidUsers:", error.message);
    return [];
  }

  return (data || []).map(u => u.chat_id);
}

async function getAllUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("chat_id");

  if (error) {
    console.error("❌ getAllUsers:", error.message);
    return [];
  }

  return (data || []).map(u => u.chat_id);
}

async function getAllUnpaidUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("chat_id")
    .eq("is_paid", false);

  if (error) {
    console.error("❌ getAllUnpaidUsers:", error.message);
    return [];
  }

  return (data || []).map(u => u.chat_id);
}

// ─────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────
async function saveSubscription(
  chatId,
  planLabel,
  packageType,
  price,
  expiresAt,
  inviteLink,
  inviteLinkId,
  mpesaCode,
  username
) {
  const { error } = await supabase.from("subscriptions").upsert(
    {
      chat_id:        String(chatId),
      plan_label:     planLabel,
      package_type:   packageType,
      price,
      expires_at:     new Date(expiresAt),
      invite_link:    inviteLink    || null,
      invite_link_id: inviteLinkId  || null,
      mpesa_code:     mpesaCode     || null,
      username:       username      || String(chatId),
    },
    {
      onConflict: "chat_id"
    }
  );

  if (error) console.error("❌ saveSubscription:", error.message);
}

async function getSubscription(chatId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("chat_id", String(chatId))
    .maybeSingle();

  if (error) {
    console.error("❌ getSubscription:", error.message);
    return null;
  }

  return data;
}

async function deleteSubscription(chatId) {
  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("chat_id", String(chatId));

  if (error) console.error("❌ deleteSubscription:", error.message);
}

async function getAllActiveSubscriptions() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .gt("expires_at", new Date().toISOString());

  if (error) {
    console.error("❌ getAllActiveSubscriptions:", error.message);
    return [];
  }

  return data || [];
}

// ─────────────────────────────────────────────
// ENGAGEMENT LOGS
// ─────────────────────────────────────────────
async function getEngagementCountToday(chatId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("engagement_log")
    .select("*", { count: "exact", head: true })
    .eq("chat_id", String(chatId))
    .gte("sent_at", since);

  if (error) {
    console.error("❌ getEngagementCountToday:", error.message);
    return 0;
  }

  return count || 0;
}

async function logEngagement(chatId, message) {
  const { error } = await supabase.from("engagement_log").insert({
    chat_id: String(chatId),
    message
  });

  if (error) console.error("❌ logEngagement:", error.message);
}

// ─────────────────────────────────────────────
// BROADCAST LOG
// ─────────────────────────────────────────────
async function logBroadcast(chatId, message) {
  const { error } = await supabase.from("broadcast_log").insert({
    chat_id: String(chatId),
    message
  });

  if (error) console.error("❌ logBroadcast:", error.message);
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  initDB,
  upsertUser,
  markUserPaid,
  markUserUnpaid,
  getAllPaidUsers,
  getAllUnpaidUsers,
  getAllUsers,
  saveSubscription,
  getSubscription,
  deleteSubscription,
  getAllActiveSubscriptions,
  getEngagementCountToday,
  logEngagement,
  logBroadcast
};
