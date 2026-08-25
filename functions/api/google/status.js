import { GMAIL_SCOPE, hasScope, json, readSession } from "./_lib.js";

export async function onRequestGet(context) {
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
  } catch (_) {
    return json({ connected: false, status: "unconfigured", error: "Google OAuth is not configured." });
  }
}
