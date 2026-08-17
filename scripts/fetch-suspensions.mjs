#!/usr/bin/env node
/* =============================================================
   scripts/fetch-suspensions.mjs
   Out-of-band updater for data/suspensions.json.

   Runs in GitHub Actions (Node 20+, global fetch). A static browser
   frontend cannot read quezoncity.gov.ph directly (server-rendered
   HTML, no JSON API/RSS, CORS-blocked), so this job reads the OFFICIAL
   public announcements page server-side and writes NORMALIZED objects
   the frontend consumes. Nothing is fabricated: every item carries the
   source title + URL. On any failure or empty parse we PRESERVE the
   existing file — a fetch failure must never become "no suspension".
   ============================================================= */
import { readFile, writeFile } from "node:fs/promises";

const SRC = "https://quezoncity.gov.ph/news-and-media/announcements/";
const OUT = new URL("../data/suspensions.json", import.meta.url);

const SUSP_RE = /(walang\s+pasok|class(?:es)?\s+(?:are\s+)?suspend|suspension\s+of\s+class|no\s+class(?:es)?|cancellation\s+of\s+class|face-?to-?face\s+class(?:es)?\s+(?:are\s+)?suspend)/i;
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}
function pad(n){ return n < 10 ? "0"+n : ""+n; }
function parseDate(text) {
  const t = String(text||"").toLowerCase();
  let m = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(t);
  if (m && MONTHS[m[1].slice(0,3)]) return `${m[3]}-${pad(MONTHS[m[1].slice(0,3)])}-${pad(+m[2])}`;
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return m[0];
  return null;
}
function decode(s) {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g,"&").replace(/&#8211;|&ndash;/g,"–").replace(/&#8217;/g,"’")
    .replace(/&nbsp;/g," ").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/\s+/g," ").trim();
}

// Extract candidate announcements as {title, url} from anchor + heading text.
function extractCandidates(html) {
  const out = [];
  const seen = new Set();
  // Anchors (most announcement titles are links).
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html)) !== null) {
    const url = m[1], title = decode(m[2]);
    if (title.length < 8 || !SUSP_RE.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url: url.startsWith("http") ? url : new URL(url, SRC).href });
  }
  // Headings (fallback if titles are not linked).
  const hRe = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  while ((m = hRe.exec(html)) !== null) {
    const title = decode(m[1]);
    if (title.length < 8 || !SUSP_RE.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url: SRC });
  }
  return out;
}

async function main() {
  const today = manilaToday();
  let html;
  try {
    const res = await fetch(SRC, {
      headers: { "User-Agent": "QCU-Portal-SuspensionBot/1.0 (+public announcements reader)" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    html = await res.text();
  } catch (e) {
    console.error("Fetch failed — PRESERVING existing feed (never wipe to empty):", e.message);
    process.exit(0); // Do not modify the file. Absence of update ≠ "no suspension".
  }

  const candidates = extractCandidates(html);
  console.log(`Found ${candidates.length} suspension-like candidate(s).`);

  const items = [];
  for (const c of candidates) {
    const eff = parseDate(c.title);
    if (eff && eff < today) continue; // drop clearly-expired
    items.push({
      title: c.title,
      body: "",
      effectiveDate: eff || today,
      publishedAt: today,
      source: "Quezon City Government",
      sourceUrl: c.url || SRC
    });
  }

  // Preserve existing file if parsing yielded nothing (site markup may change).
  if (items.length === 0) {
    console.error("No parseable suspension items — PRESERVING existing feed.");
    process.exit(0);
  }

  let prev = "";
  try { prev = await readFile(OUT, "utf8"); } catch {}
  const next = JSON.stringify(items, null, 2) + "\n";
  if (prev.trim() === next.trim()) {
    console.log("No change.");
    process.exit(0);
  }
  await writeFile(OUT, next, "utf8");
  console.log(`Wrote ${items.length} item(s) to data/suspensions.json`);
}

main().catch((e) => { console.error("Unexpected error — not modifying feed:", e); process.exit(0); });

