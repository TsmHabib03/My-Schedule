/**
 * Cloudflare Pages Function — GET /api/suspensions
 *
 * Server-side proxy + scraper for Quezon City class-suspension notices.
 * The browser cannot fetch quezoncity.gov.ph directly (CORS), so this
 * function fetches the public announcements page, keyword-filters the
 * headlines/bodies for genuine suspension notices, and returns the SAME
 * JSON array shape as data/suspensions.json:
 *
 *   [{ title, body, effectiveDate, publishedAt, reason, source, sourceUrl }]
 *
 * Safety: on any upstream failure it returns [] (an empty array = "no
 * active suspension"), never a fabricated notice. The client treats a
 * non-OK response as UNKNOWN and falls back to the bundled JSON, so an
 * empty array here is a deliberate "nothing to report", not an outage.
 */

const SOURCE_NAME = "Quezon City Government";
const ANNOUNCE_URL = "https://quezoncity.gov.ph/news-and-media/announcements/";

// A headline must mention a suspension trigger AND clearly be about classes /
// government work to count. Kept conservative so unrelated announcements
// (events, advisories, job posts) never surface as a "walang pasok".
const TRIGGER = /(walang\s+pasok|class(es)?\s+suspen|suspension\s+of\s+class|no\s+classes|face[-\s]?to[-\s]?face)/i;
const CONTEXT = /(class|pasok|student|school|level|academic|face[-\s]?to[-\s]?face|online)/i;

function jsonResponse(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      // Edge-cache ~12 min so we stay fresh without hammering the QC site.
      "Cache-Control": "public, max-age=600, s-maxage=720"
    }, extraHeaders || {})
  });
}

// Strip HTML tags / collapse whitespace / decode the few entities we expect.
function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#8217;|&rsquo;/gi, "’")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Very light extraction: pull candidate "cards" from anchor/heading text on
// the listing page. We are tolerant of markup changes — anything that reads
// like a suspension headline is captured, everything else is ignored.
function extractCandidates(html) {
  const out = [];
  const seen = new Set();

  // Headings and links are where announcement titles live.
  const re = /<(?:h[1-4]|a)[^>]*>([\s\S]*?)<\/(?:h[1-4]|a)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text.length < 12 || text.length > 220) continue;
    if (!TRIGGER.test(text)) continue;
    if (!CONTEXT.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= 8) break;
  }
  return out;
}

// Try to read a date out of the headline ("August 17, 2026" / "Aug 17"),
// otherwise leave effectiveDate null and let the client decide relevance.
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};
function parseEffectiveDate(text) {
  const m = text.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const day = parseInt(m[2], 10);
  const year = m[3] ? parseInt(m[3], 10) : new Date().getUTCFullYear();
  if (!day || day > 31) return null;
  return year + "-" + String(mon).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function toNotice(title, publishedAt) {
  return {
    title: title,
    body: title,
    effectiveDate: parseEffectiveDate(title),
    publishedAt: publishedAt,
    reason: /rain|typhoon|weather|storm|bagyo|flood/i.test(title) ? "Inclement weather" : "",
    source: SOURCE_NAME,
    sourceUrl: ANNOUNCE_URL
  };
}

export async function onRequestOptions() {
  return jsonResponse([], 204);
}

export async function onRequestGet() {
  const nowIso = new Date().toISOString();
  try {
    const res = await fetch(ANNOUNCE_URL, {
      headers: {
        "User-Agent": "QCU-Student-Portal/1.0 (+https://quezoncity.gov.ph)",
        "Accept": "text/html,application/xhtml+xml"
      },
      // Let CF cache the upstream fetch briefly too.
      cf: { cacheTtl: 600, cacheEverything: true }
    });
    if (!res.ok) throw new Error("upstream HTTP " + res.status);
    const html = await res.text();
    const titles = extractCandidates(html);
    const notices = titles.map(function (t) { return toNotice(t, nowIso); });
    return jsonResponse(notices, 200);
  } catch (err) {
    // Never fabricate a suspension. Empty array = "nothing active"; the client
    // falls back to the bundled JSON if it needs a last-known notice.
    return jsonResponse([], 200, { "X-Suspensions-Error": String(err && err.message || err).slice(0, 120) });
  }
}
