import { GMAIL_SCOPE, hasScope, json, readSession } from "./_lib.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_SESSION_SECRET"];
  const missing = required.filter(name => !String(env[name] || "").trim());
  const invalid = [];
  if (!missing.includes("GOOGLE_SESSION_SECRET") && String(env.GOOGLE_SESSION_SECRET).length < 24) {
    invalid.push("GOOGLE_SESSION_SECRET (must be at least 24 characters)");
  }
  if (missing.length || invalid.length) {
    return json({
      connected: false,
      status: "unconfigured",
      error: "Google OAuth environment variables are incomplete.",
      missing,
      invalid
    });
  }
  try {
    const session = await readSession(context);
    if (!session) return json({ connected: false, status: "not_connected" });
    return json({
      connected: true,
      status: "connected",
      email: session.email || "Google account",
      preferences: session.preferences || { classroom: true, gmail: false, autoRefresh: true },
      permissions: { classroom: true, gmail: hasScope(session, GMAIL_SCOPE) },
      connectedAt: session.connectedAt || null
    });
  } catch (error) {
    return json({
      connected: false,
      status: "unconfigured",
      error: "Google OAuth configuration could not be loaded.",
      detail: String(error && error.message || "Unknown configuration error").slice(0, 160)
    });
  }
}
