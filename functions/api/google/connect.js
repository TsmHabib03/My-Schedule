import { buildAuthorizationUrl, oauthConfig, oauthStateHeader, redirect, safeReturnTo } from "./_lib.js";

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const includeGmail = url.searchParams.get("gmail") === "1";
    const nonce = crypto.randomUUID();
    const returnTo = safeReturnTo(url.searchParams.get("return"));
    const config = oauthConfig(context);
    const state = { nonce, includeGmail, returnTo, createdAt: Date.now() };
    return redirect(buildAuthorizationUrl(config, nonce, includeGmail), {
      "Set-Cookie": await oauthStateHeader(context, state)
    });
  } catch (_) {
    return redirect("/settings.html?google=unconfigured#google-integration");
  }
}
