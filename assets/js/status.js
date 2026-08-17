/* =============================================================
   status.js — Home "Today in Quezon City" panel
   Weather (Open-Meteo, keyless) + reliable Class-Suspension engine.
   Loaded ONLY on index.html. Mirrors the eta.js page-script pattern.

   NO API KEY: Open-Meteo requires none, so nothing is hardcoded or
   exposed in frontend source (honors the no-key constraint).

   SUSPENSION DATA — data/suspensions.json (normalized feed). Because a
   static frontend cannot fetch quezoncity.gov.ph directly (no CORS/JSON
   API — the page is server-rendered HTML), the feed is kept current by
   an out-of-band job (GitHub Action / proxy) that reads the OFFICIAL QC
   announcements page and writes normalized objects. Nothing is ever
   fabricated. A fetch failure becomes UNKNOWN — NEVER "no suspension".

   Feed object shape (all optional except a suspension-like title/body):
     {
       "title": "Walang Pasok: Afternoon Face-to-Face Classes – August 17, 2026",
       "body":  "…full announcement text…",
       "effectiveDate": "2026-08-17",   // when the suspension applies
       "publishedAt":   "2026-08-17",   // when it was announced
       "reason": "Continued heavy rain",
       "source": "Quezon City Government",
       "sourceUrl": "https://quezoncity.gov.ph/news-and-media/announcements/",
       "active": true                   // optional hard override for "today"
     }
   Period / modality / education-level / QCU-coverage are PARSED from
   title+body — see the SUSPENSION ENGINE section. The engine is
   schedule-aware: it matches the suspended window against the user's
   real class times to decide SUSPENDED / PARTIALLY_AFFECTED / NOT.
   ============================================================= */
(function () {
  "use strict";

  var CFG = Object.assign({
    lat: 14.689, lon: 121.0437, place: "Quezon City",
    weatherTtlMin: 15,
    suspFeed: "data/suspensions.json",
    scheduleFeed: "data/schedule.json",
    floodFeed: "data/flood.json",
    debug: false,
    /* Time windows (Asia/Manila, 24h "HH:MM") — single source of truth,
       no scattered magic numbers. Afternoon spans noon→6pm. */
    windows: {
      MORNING:   { start: "00:00", end: "12:00", label: "Morning" },
      AFTERNOON: { start: "12:00", end: "18:00", label: "Afternoon" },
      EVENING:   { start: "18:00", end: "23:59", label: "Evening" }
    },
    officialLinks: [
      { label: "QC Government", url: "https://quezoncity.gov.ph/news-and-media/announcements/" },
      { label: "QCU", url: "https://qcu.edu.ph" }
    ]
  }, window.QCU_STATUS_CONFIG || {});
  var root = document.getElementById("home-status");
  if (!root) return; // Guard: only run on the Home page.

  var CACHE_KEY = "qcu-weather-cache";

  function dbg() {
    if (CFG.debug && window.console && console.log)
      console.log.apply(console, ["[QCU-STATUS]"].concat([].slice.call(arguments)));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function iconify() { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }

  /* --- Manila-local date/time helpers (no scattered magic numbers) --- */
  function manilaToday() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  // Minutes-since-midnight, Asia/Manila (used for schedule-window matching).
  function manilaNowMin() {
    try {
      var p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      return toMin(p);
    } catch (e) { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  }
  // Manila weekday name ("Monday"…) for schedule lookup.
  function manilaWeekday() {
    try { return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "long" }).format(new Date()); }
    catch (e) { return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()]; }
  }
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return null;
    var h = +m[1], mm = +m[2];
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  }
  function fmtClock(min) {
    if (min == null) return "--";
    var h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12;
    return h12 + ":" + (m < 10 ? "0" + m : m) + " " + ap;
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  // "August 17, 2026" | "Aug 17 2026" | "17 August 2026" -> "YYYY-MM-DD" | null
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseDatePhrase(text, todayStr) {
    var t = String(text || "").toLowerCase();
    if (/\b(bukas|tomorrow)\b/.test(t)) return addDays(todayStr, 1);
    if (/\b(ngayong araw|ngayon|today|this afternoon|this morning|ngayong hapon|ngayong umaga)\b/.test(t)) return todayStr;
    var m = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(t);           // Month DD, YYYY
    if (m && MONTHS[m[1].slice(0, 3)]) return iso(m[3], MONTHS[m[1].slice(0, 3)], m[2]);
    m = /\b(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\b/.exec(t);                  // DD Month YYYY
    if (m && MONTHS[m[2].slice(0, 3)]) return iso(m[3], MONTHS[m[2].slice(0, 3)], m[1]);
    m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);                                // ISO
    if (m) return m[0];
    return null;
  }
  function iso(y, mo, d) { return y + "-" + (mo < 10 ? "0" + mo : mo) + "-" + (+d < 10 ? "0" + d : d); }

  /* =============================================================
     WEATHER (Open-Meteo, keyless) — WMO code → label/icon/severity.
     severity 0 clear · 1 cloud · 2 light rain · 3 rain · 4 severe.
     ============================================================= */
  var WMO = {
    0: ["Clear sky", "sun", 0], 1: ["Mainly clear", "sun", 0], 2: ["Partly cloudy", "cloud-sun", 1],
    3: ["Overcast", "cloud", 1], 45: ["Fog", "cloud-fog", 1], 48: ["Rime fog", "cloud-fog", 1],
    51: ["Light drizzle", "cloud-drizzle", 2], 53: ["Drizzle", "cloud-drizzle", 2], 55: ["Dense drizzle", "cloud-drizzle", 2],
    56: ["Freezing drizzle", "cloud-drizzle", 2], 57: ["Freezing drizzle", "cloud-drizzle", 2],
    61: ["Light rain", "cloud-rain", 2], 63: ["Rain", "cloud-rain", 3], 65: ["Heavy rain", "cloud-rain-wind", 4],
    66: ["Freezing rain", "cloud-rain", 3], 67: ["Freezing rain", "cloud-rain-wind", 4],
    71: ["Light snow", "cloud-snow", 2], 73: ["Snow", "cloud-snow", 3], 75: ["Heavy snow", "cloud-snow", 4],
    77: ["Snow grains", "cloud-snow", 2], 80: ["Rain showers", "cloud-rain", 3], 81: ["Rain showers", "cloud-rain", 3],
    82: ["Violent showers", "cloud-rain-wind", 4], 85: ["Snow showers", "cloud-snow", 3], 86: ["Snow showers", "cloud-snow", 4],
    95: ["Thunderstorm", "cloud-lightning", 4], 96: ["Thunderstorm w/ hail", "cloud-lightning", 4], 99: ["Severe thunderstorm", "cloud-lightning", 4]
  };
  function wmo(code) { return WMO[code] || ["Unknown", "cloud", 1]; }
  // Uppercase institutional status label, e.g. "RAIN EXPECTED".
  function weatherStatusLabel(code, pop) {
    var sev = wmo(code)[2];
    if (sev >= 4) return "SEVERE WEATHER";
    if (sev === 3) return "RAIN EXPECTED";
    if (sev === 2) return (pop != null && pop >= 50) ? "RAIN LIKELY" : "LIGHT RAIN";
    if (sev === 1) return "CLOUDY";
    return "FAIR WEATHER";
  }
  function weatherSevClass(code) {
    var sev = wmo(code)[2];
    return sev >= 4 ? "sev-severe" : sev === 3 ? "sev-high" : sev === 2 ? "sev-mod" : sev === 1 ? "sev-low" : "sev-clear";
  }
  // Weather-based advisory ONLY. NEVER an official suspension signal.
  function computeRisk(code, pop) {
    var sev = wmo(code)[2];
    var p = (pop == null ? 0 : pop);
    if (sev >= 4) return "SEVERE";
    if (sev >= 3 && p >= 60) return "HIGH";
    if (sev >= 3 || (sev >= 2 && p >= 70)) return "MODERATE";
    return "LOW";
  }

  /* =============================================================
     SUSPENSION ENGINE
     Structured, schedule-aware, source-prioritized. A false
     "No Suspension" is worse than "Unavailable", so on any doubt we
     lean toward flagging, never toward silently clearing.
     ============================================================= */
  var STATUS = {
    SUSPENDED: "SUSPENDED", NOT_SUSPENDED: "NOT_SUSPENDED",
    PARTIALLY_AFFECTED: "PARTIALLY_AFFECTED", PENDING: "PENDING", UNKNOWN: "UNKNOWN"
  };

  // Broad multi-phrasing detector (English + Filipino), title AND body.
  var SUSP_RE = /(walang\s+pasok|class(?:es)?\s+(?:are\s+)?suspend|suspension\s+of\s+class|no\s+class(?:es)?|cancellation\s+of\s+class|classes?\s+cancel|face-?to-?face\s+class(?:es)?\s+(?:are\s+)?suspend|suspend\w*\s+.{0,30}?class|walang\s+klase|holiday\s+for\s+all\s+school)/i;
  function looksLikeSuspension(text) { return SUSP_RE.test(String(text || "")); }

  // Period → which window (in minutes) the suspension covers.
  function detectPeriod(text) {
    var t = String(text || "").toLowerCase(), w = CFG.windows;
    var out = function (name, key) { return { period: name, startMin: toMin(w[key].start), endMin: toMin(w[key].end) }; };
    if (/\b(all[-\s]?day|whole\s+day|entire\s+day|buong\s+araw|full\s+day)\b/.test(t))
      return { period: "ALL_DAY", startMin: 0, endMin: 1439 };
    var morning = /\b(morning|a\.?m\.?|umaga|ngayong\s+umaga)\b/.test(t);
    var afternoon = /\b(afternoon|p\.?m\.?|hapon|ngayong\s+hapon|noon\s+onwards?|12\s*(?:noon|nn))\b/.test(t);
    var evening = /\b(evening|night|gabi)\b/.test(t);
    if (afternoon && !morning) return out("AFTERNOON", "AFTERNOON");
    if (morning && !afternoon && !evening) return out("MORNING", "MORNING");
    if (evening && !morning && !afternoon) return out("EVENING", "EVENING");
    // Unspecified period → assume ALL_DAY (safer: never under-report). Confidence lowered elsewhere.
    return { period: "UNKNOWN", startMin: 0, endMin: 1439 };
  }

  // Modality: a face-to-face suspension does NOT stop online classes.
  function detectModality(text) {
    var t = String(text || "").toLowerCase();
    if (/(face-?to-?face|f2f|in-?person|on-?site|onsite|physical\s+class)/.test(t)) return "FACE_TO_FACE";
    if (/(online|distance\s+learning|modular|asynchronous|remote)\s+class(?:es)?\s+(?:are\s+)?suspend/.test(t)) return "ONLINE";
    return "ALL"; // No modality qualifier → all modalities affected.
  }

  // Education levels present in the text.
  function detectLevels(text) {
    var t = String(text || "").toLowerCase();
    return {
      qcu: /\bqcu\b|quezon\s+city\s+university/.test(t),
      kinder: /\bkinder|kindergarten|pre-?school\b/.test(t),
      elem: /\belementary|grade\s*school|grades?\s*[1-6]\b/.test(t),
      jhs: /\bjunior\s+high|jhs|grades?\s*7-?10\b/.test(t),
      shs: /\bsenior\s+high|shs|grades?\s*11-?12\b/.test(t),
      college: /\bcollege|tertiary|university|universities|higher\s+education|\bhei\b/.test(t),
      allK12: /\b(all\s+levels|all\s+school|public\s+and\s+private\s+school|basic\s+education|elementary\s+and\s+(?:junior|senior)?\s*high)\b/.test(t),
      all: /\ball\s+levels\b/.test(t)
    };
  }
  // Does this announcement cover QCU (a tertiary/HEI)? → true | false | "maybe"
  function coversQcu(lv) {
    if (lv.qcu) return true;
    if (lv.all || lv.college) return true;
    // K-12-only announcement (elem/jhs/shs/kinder, no college/all) → does NOT cover QCU.
    if ((lv.kinder || lv.elem || lv.jhs || lv.shs || lv.allK12) && !lv.college && !lv.all) return false;
    return "maybe"; // Level unspecified → cannot rule QCU out; verify.
  }
  function levelLabel(lv) {
    if (lv.qcu) return "QCU (named)";
    if (lv.all) return "All levels";
    if (lv.college) return "College / tertiary";
    if (lv.allK12 || lv.kinder || lv.elem || lv.jhs || lv.shs) {
      var parts = [];
      if (lv.kinder) parts.push("Kinder"); if (lv.elem) parts.push("Elementary");
      if (lv.jhs) parts.push("JHS"); if (lv.shs) parts.push("SHS");
      return parts.length ? parts.join(" · ") : "Basic education (K–12)";
    }
    return "Not specified";
  }

  // Resolve when a suspension APPLIES (not when it was posted).
  function resolveEffectiveDate(a, todayStr) {
    if (a && a.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(a.effectiveDate)) return a.effectiveDate;
    if (a && a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) return a.date; // backward-compat
    var fromText = parseDatePhrase((a && a.title || "") + " " + (a && a.body || ""), todayStr);
    if (fromText) return fromText;
    if (a && a.active === true) return todayStr; // hard override implies "today"
    return null; // unknown → handled as low-confidence "today" by caller
  }

  // Normalize a raw feed item into the engine's internal shape.
  function normalizeAnnouncement(a, todayStr) {
    var text = (a.title || "") + "\n" + (a.body || "");
    var per = detectPeriod(text);
    var lv = detectLevels(text);
    var eff = resolveEffectiveDate(a, todayStr);
    return {
      raw: a,
      title: a.title || "Class suspension announcement",
      body: a.body || "",
      text: text,
      effectiveDate: eff,
      publishedAt: (a.publishedAt || a.date || null),
      period: per.period, startMin: per.startMin, endMin: per.endMin,
      modality: detectModality(text),
      levels: lv,
      levelLabel: levelLabel(lv),
      coversQcu: coversQcu(lv),
      reason: a.reason || null,
      source: a.source || "Official announcement",
      sourceUrl: a.sourceUrl || (CFG.officialLinks[0] && CFG.officialLinks[0].url),
      scope: a.scope || (lv.qcu ? "Institution (QCU)" : (a.source && /national|deped|ched|pagasa/i.test(a.source) ? "National" : "Citywide"))
    };
  }
  // Relevance priority for conflict resolution among same-day items:
  // QCU-named > All-levels/HEI/college > unspecified > K-12-only.
  function priority(n) {
    if (n.coversQcu === true && n.levels.qcu) return 4;
    if (n.coversQcu === true) return 3;
    if (n.coversQcu === "maybe") return 2;
    return 1; // K-12-only (does not cover QCU)
  }

  // Choose the governing announcement for today + the nearest upcoming one.
  function pickAnnouncement(list, todayStr) {
    var norm = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || typeof a !== "object") continue;
      var text = (a.title || "") + " " + (a.body || "");
      if (!looksLikeSuspension(text) && a.active !== true) continue; // not a suspension item
      norm.push(normalizeAnnouncement(a, todayStr));
    }
    var active = [], upcoming = [];
    for (var j = 0; j < norm.length; j++) {
      var n = norm[j], eff = n.effectiveDate;
      if (eff == null) { active.push(n); continue; }      // undated but suspension-like → treat as today (verify)
      if (eff === todayStr || n.raw.active === true) active.push(n);
      else if (eff > todayStr) upcoming.push(n);          // future → PENDING
      // eff < todayStr → expired, silently dropped
    }
    active.sort(function (x, y) { return priority(y) - priority(x); });
    upcoming.sort(function (x, y) { return String(x.effectiveDate).localeCompare(String(y.effectiveDate)); });
    return { active: active[0] || null, upcoming: upcoming[0] || null, activeCount: active.length };
  }

  // Decide what one class means under the active notice — time-overlap AND
  // modality aware. Returns { status, note, overlap }:
  //   PROCEEDS     — no time overlap, OR an online-only suspension against a
  //                  physical (face-to-face) class.
  //   ONLINE_ONLY  — a face-to-face suspension overlaps the class: the in-person
  //                  session is off, but online/async work may proceed.
  //   SUSPENDED    — an all-modality (or whole-day) suspension overlaps the class,
  //                  OR an online-only suspension overlaps an online class.
  // Never fabricates a session that isn't scheduled — notes are framed as
  // "may proceed / confirm with your instructor."
  function evaluateClassStatus(cl, n) {
    var oStart = Math.max(cl.start, n.startMin), oEnd = Math.min(cl.end, n.endMin);
    var overlap = oEnd > oStart;
    if (!overlap) return { status: "PROCEEDS", note: null, overlap: false };

    var isPhysical = !!(cl.room || cl.building);
    var partial = !(cl.start >= n.startMin && cl.end <= n.endMin);
    var win = windowWord(n.period);
    var winPhrase = win ? " for the " + win + " period" : "";
    var partWord = partial ? " Your class only partly falls within the suspended window." : "";

    if (n.modality === "ONLINE") {
      // Only online sessions are suspended → a face-to-face class is unaffected.
      if (isPhysical) return { status: "PROCEEDS", note: null, overlap: true };
      return { status: "SUSPENDED", note: "Online sessions are suspended" + winPhrase + "." + partWord, overlap: true };
    }
    if (n.modality === "FACE_TO_FACE") {
      return {
        status: "ONLINE_ONLY",
        note: "In-person (face-to-face) session suspended" + winPhrase +
          " — online/asynchronous work may proceed; confirm with your instructor." + partWord,
        overlap: true
      };
    }
    // ALL modality (or unspecified) → the whole class is suspended.
    return { status: "SUSPENDED", note: "Classes are suspended" + winPhrase + "." + partWord, overlap: true };
  }

  // Match today's real class times against the suspended window.
  // Returns per-class verdicts + aggregate flags. Overlap = affected.
  function matchSchedule(n, schedule, todayStr) {
    var day = manilaWeekday();
    var todays = [];
    if (Array.isArray(schedule)) {
      for (var i = 0; i < schedule.length; i++) {
        var c = schedule[i];
        if (!c || c.day !== day || c.noClasses) continue;
        var s = toMin(c.start), e = toMin(c.end);
        if (s == null || e == null) continue;
        todays.push({
          start: s, end: e, subject: c.subject || c.code || "Class",
          course: c.course || "", code: c.code || "",
          room: c.room || "", building: c.building || ""
        });
      }
    }
    todays.sort(function (a, b) { return a.start - b.start; });
    var classes = [], nSusp = 0, nOnline = 0;
    for (var k = 0; k < todays.length; k++) {
      var cl = todays[k];
      var ev = evaluateClassStatus(cl, n);
      if (ev.status === "SUSPENDED") nSusp++;
      else if (ev.status === "ONLINE_ONLY") nOnline++;
      classes.push({
        subject: cl.subject, course: cl.course, code: cl.code,
        start: cl.start, end: cl.end, room: cl.room, building: cl.building,
        verdict: ev.status, note: ev.note
      });
    }
    return { day: day, classes: classes, total: todays.length, suspended: nSusp, onlineOnly: nOnline, affected: nSusp + nOnline };
  }

  // MAIN: structured suspension status for QCU.
  // list === undefined  → fetch/network failure → UNKNOWN (NEVER not-suspended).
  // list === []         → feed loaded, no items → NOT_SUSPENDED (+ optional weather advisory).
  function getQcuSuspensionStatus(list, schedule, weatherRisk) {
    var today = manilaToday();
    var base = {
      status: STATUS.UNKNOWN, headline: "", scope: null, affectedLevel: null,
      period: null, modality: null, reason: null, publishedAt: null, effectiveDate: null,
      source: null, sourceUrl: (CFG.officialLinks[0] && CFG.officialLinks[0].url),
      confidence: "low", coversQcu: null, classes: null, note: null,
      weatherRisk: weatherRisk || null, checkedAt: today
    };

    if (typeof list === "undefined") {
      base.status = STATUS.UNKNOWN;
      base.note = "Suspension source is temporarily unavailable — this is NOT a confirmation that classes are on. Please verify with the official channels below.";
      dbg("status=UNKNOWN (feed unavailable)");
      return base;
    }
    if (!Array.isArray(list)) list = [];

    var pick = pickAnnouncement(list, today);
    var n = pick.active;

    if (!n) {
      // No active official suspension. Weather may add an ADVISORY, never a status.
      base.status = STATUS.NOT_SUSPENDED;
      base.confidence = "high";
      if (pick.upcoming) {
        base.status = STATUS.PENDING;
        base.headline = "Upcoming suspension announced";
        base.effectiveDate = pick.upcoming.effectiveDate;
        base.scope = pick.upcoming.scope;
        base.affectedLevel = pick.upcoming.levelLabel;
        base.period = pick.upcoming.period;
        base.modality = pick.upcoming.modality;
        base.reason = pick.upcoming.reason;
        base.source = pick.upcoming.source;
        base.sourceUrl = pick.upcoming.sourceUrl;
        base.publishedAt = pick.upcoming.publishedAt;
        base.confidence = "medium";
      }
      dbg("status=" + base.status + " (no active suspension today)");
      return base;
    }

    // We have an active, suspension-like official item today.
    base.scope = n.scope; base.affectedLevel = n.levelLabel; base.period = n.period;
    base.modality = n.modality; base.reason = n.reason; base.source = n.source;
    base.sourceUrl = n.sourceUrl; base.publishedAt = n.publishedAt;
    base.effectiveDate = n.effectiveDate || today; base.coversQcu = n.coversQcu;

    if (n.coversQcu === false) {
      // Real announcement, but K-12 only → QCU classes proceed.
      base.status = STATUS.NOT_SUSPENDED;
      base.headline = "Suspension does not cover QCU";
      base.confidence = "high";
      base.note = "An official suspension is in effect for " + n.levelLabel + ", which does not include QCU (a university). QCU classes are not covered by this notice.";
      dbg("status=NOT_SUSPENDED (K-12 only, QCU not covered)");
      return base;
    }

    // Covers QCU (true) or unspecified ("maybe"). Go schedule-aware.
    var sched = matchSchedule(n, schedule, today);
    base.classes = sched.classes;
    var confMaybe = (n.coversQcu === "maybe");
    base.confidence = confMaybe ? "medium" : (n.period === "UNKNOWN" ? "medium" : "high");

    if (sched.total === 0) {
      base.status = STATUS.SUSPENDED;
      base.headline = "Class suspension in effect";
      base.note = "You have no classes scheduled today (" + sched.day + ")." + (confMaybe ? " Education level was not stated in the announcement — verify QCU coverage below." : "");
    } else if (sched.affected === 0) {
      base.status = STATUS.NOT_SUSPENDED;
      base.headline = "Suspension does not overlap your classes";
      base.note = "A " + windowWord(n.period) + " suspension is in effect, but none of your classes today (" + sched.day + ") fall in that window.";
    } else if (sched.suspended === 0 && sched.onlineOnly > 0) {
      // Only in-person sessions are affected; online/async may proceed.
      base.status = STATUS.PARTIALLY_AFFECTED;
      base.headline = "Face-to-face classes affected";
    } else if (sched.suspended === sched.total) {
      base.status = STATUS.SUSPENDED;
      base.headline = "Class suspension in effect";
    } else {
      base.status = STATUS.PARTIALLY_AFFECTED;
      base.headline = "Some classes affected";
    }
    if (n.modality === "FACE_TO_FACE" && base.status !== STATUS.NOT_SUSPENDED)
      base.note = (base.note ? base.note + " " : "") + "Applies to FACE-TO-FACE classes — online/asynchronous sessions may proceed unless told otherwise.";
    if (confMaybe && base.status !== STATUS.NOT_SUSPENDED)
      base.note = (base.note ? base.note + " " : "") + "Education level not stated — confirm QCU is covered via the official links.";
    dbg("status=" + base.status, "period=" + n.period, "modality=" + n.modality, "coversQcu=" + n.coversQcu, sched);
    return base;
  }
  function windowWord(period) {
    return period === "MORNING" ? "morning" : period === "AFTERNOON" ? "afternoon" :
      period === "EVENING" ? "evening" : period === "ALL_DAY" ? "whole-day" : "";
  }

  /* =============================================================
     FETCHERS — every remote call fails soft. A failed suspension
     fetch yields `undefined` (→ UNKNOWN), never `[]` (→ not-suspended).
     ============================================================= */
  function fetchWeather() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.t && (Date.now() - c.t) < CFG.weatherTtlMin * 60000 && c.data) {
          dbg("weather from cache"); return Promise.resolve(c.data);
        }
      }
    } catch (e) { /* ignore cache errors */ }
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + CFG.lat + "&longitude=" + CFG.lon +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation" +
      "&hourly=precipitation_probability&timezone=Asia%2FManila&forecast_days=1";
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("weather HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var cur = j.current || {};
      var pop = null;
      try {
        var hrs = j.hourly && j.hourly.time || [], probs = j.hourly && j.hourly.precipitation_probability || [];
        var nowH = new Date().toISOString().slice(0, 13);
        for (var i = 0; i < hrs.length; i++) { if (String(hrs[i]).slice(0, 13) >= nowH) { pop = probs[i]; break; } }
        if (pop == null && probs.length) pop = probs[0];
      } catch (e) { /* ignore */ }
      var data = {
        temp: cur.temperature_2m, feels: cur.apparent_temperature, humidity: cur.relative_humidity_2m,
        code: cur.weather_code, precip: cur.precipitation, pop: pop
      };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: data })); } catch (e) {}
      return data;
    }).catch(function (e) { dbg("weather failed", e); return null; });
  }
  // Returns array on success, [] for empty feed, undefined on failure.
  function fetchSuspensions() {
    return fetch(CFG.suspFeed, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("susp HTTP " + r.status);
      return r.json();
    }).then(function (j) { return Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []); })
      .catch(function (e) { dbg("suspensions fetch FAILED → UNKNOWN", e); return undefined; });
  }
  function fetchSchedule() {
    return fetch(CFG.scheduleFeed, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("schedule HTTP " + r.status);
      return r.json();
    }).then(function (j) { return Array.isArray(j) ? j : []; })
      .catch(function (e) { dbg("schedule fetch failed", e); return []; });
  }
  // Returns the normalized flood advisory object, or undefined on failure.
  // A failed/absent feed must render "advisory unavailable" — NEVER a false
  // "no flood risk". The feed itself never fabricates: an unset field is null.
  function fetchFlood() {
    return fetch(CFG.floodFeed, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("flood HTTP " + r.status);
      return r.json();
    }).then(function (j) { return (j && typeof j === "object") ? j : undefined; })
      .catch(function (e) { dbg("flood fetch failed → advisory unavailable", e); return undefined; });
  }

  /* =============================================================
     HTML BUILDERS — Part A: institutional / public-service styling.
     Weather = compact info panel. Suspension = formal notice table.
     ============================================================= */
  function weatherBlockHTML(wx, flood) {
    var inner, sevClass;
    if (!wx || wx.temp == null) {
      sevClass = "wx-unavail";
      inner =
        '<div class="wx-lead">' +
          '<div class="wx-primary"><span class="wx-temp">--</span></div>' +
          '<div class="wx-status-wrap"><span class="wx-status">WEATHER UNAVAILABLE</span>' +
          '<span class="wx-sub">Live data could not be loaded.</span></div>' +
        '</div>';
    } else {
      var w = wmo(wx.code), label = weatherStatusLabel(wx.code, wx.pop);
      sevClass = weatherSevClass(wx.code);
      var meta = [];
      if (wx.feels != null) meta.push(["Feels like", Math.round(wx.feels) + "°C"]);
      if (wx.humidity != null) meta.push(["Humidity", Math.round(wx.humidity) + "%"]);
      if (wx.pop != null) meta.push(["Rain chance", Math.round(wx.pop) + "%"]);
      if (wx.precip != null) meta.push(["Precip", (Math.round(wx.precip * 10) / 10) + " mm"]);
      var metaHtml = meta.map(function (m) {
        return '<div class="wx-metric"><span class="wx-metric-k">' + esc(m[0]) + '</span><span class="wx-metric-v">' + esc(m[1]) + '</span></div>';
      }).join("");
      inner =
        '<div class="wx-lead">' +
          '<div class="wx-primary"><span class="wx-temp">' + Math.round(wx.temp) + '</span><span class="wx-unit">°C</span>' +
            '<i data-lucide="' + w[1] + '" class="wx-icon"></i></div>' +
          '<div class="wx-status-wrap"><span class="wx-indicator" aria-hidden="true"></span>' +
            '<span class="wx-status">' + esc(label) + '</span>' +
            '<span class="wx-sub">' + esc(w[0]) + ' · ' + esc(CFG.place) + '</span></div>' +
        '</div>' +
        (metaHtml ? '<div class="wx-metrics">' + metaHtml + '</div>' : '');
    }
    return '<div class="wx-panel ' + sevClass + '">' + inner + floodBlockHTML(flood) + '</div>';
  }

  // Flood Advisory sub-widget (Google Flood Hub feed), rendered INSIDE the
  // weather card. Never fabricates: an undefined feed or UNKNOWN risk shows
  // "advisory unavailable", never a false "no flood risk". A numeric 24h
  // inundation probability is shown only when the API actually supplies one.
  var FLOOD_META = {
    EXTREME:  { cls: "is-extreme",  label: "Extreme flood risk",   icon: "alert-triangle" },
    SEVERE:   { cls: "is-severe",   label: "Severe flood risk",    icon: "alert-triangle" },
    ELEVATED: { cls: "is-elevated", label: "Above-normal level",   icon: "alert-triangle" },
    NONE:     { cls: "is-none",     label: "No flooding expected",  icon: "waves" },
    UNKNOWN:  { cls: "is-unknown",  label: "Advisory unavailable",  icon: "droplets" }
  };
  var FLOOD_TIP = {
    EXTREME:  "Avoid low-lying roads and riverbanks. Follow QC DRRMO advisories and be ready to evacuate if instructed.",
    SEVERE:   "Steer clear of flood-prone routes and underpasses. Monitor QC DRRMO and PAGASA updates closely.",
    ELEVATED: "River levels are above normal — avoid low-lying underpasses and keep an alternate route ready.",
    NONE:     "No flooding expected along nearby rivers. Keep normal precautions during heavy rain.",
    UNKNOWN:  "Live flood data is unavailable — check PAGASA and QC DRRMO before travelling in heavy rain."
  };
  var FLOOD_TREND = { RISING: "Rising", FALLING: "Falling", STABLE: "Stable" };

  function floodBlockHTML(flood) {
    var lvl = (flood && flood.riskLevel) ? String(flood.riskLevel).toUpperCase() : "UNKNOWN";
    var m = FLOOD_META[lvl] || FLOOD_META.UNKNOWN;
    var metrics = [];
    if (flood && flood.waterLevel && FLOOD_TREND[flood.waterLevel.trend])
      metrics.push(["Water level", FLOOD_TREND[flood.waterLevel.trend]]);
    if (flood && flood.outlook24h && FLOOD_META[String(flood.outlook24h).toUpperCase()])
      metrics.push(["24h outlook", FLOOD_META[String(flood.outlook24h).toUpperCase()].label]);
    if (flood && typeof flood.inundationProbability24h === "number")
      metrics.push(["24h inundation", flood.inundationProbability24h + "%"]);
    if (flood && flood.gauge && flood.gauge.river)
      metrics.push(["Nearest river", flood.gauge.river]);
    var metaHtml = metrics.map(function (x) {
      return '<div class="flood-metric"><span class="flood-metric-k">' + esc(x[0]) + '</span><span class="flood-metric-v">' + esc(x[1]) + '</span></div>';
    }).join("");
    var tip = FLOOD_TIP[lvl] || FLOOD_TIP.UNKNOWN;
    var srcUrl = (flood && flood.sourceUrl) || "https://sites.research.google/floods/";
    var srcName = (flood && flood.source) || "Google Flood Hub";
    return '<div class="wx-flood ' + m.cls + '">' +
      '<div class="flood-head">' +
        '<span class="flood-title"><i data-lucide="waves"></i>Flood Advisory</span>' +
        '<span class="flood-badge"><i data-lucide="' + m.icon + '"></i>' + esc(m.label) + '</span>' +
      '</div>' +
      (metaHtml ? '<div class="flood-metrics">' + metaHtml + '</div>' : '') +
      '<p class="flood-tip"><i data-lucide="' + (lvl === "NONE" ? "droplets" : (lvl === "UNKNOWN" ? "info" : "alert-triangle")) + '"></i>' + esc(tip) + '</p>' +
      '<p class="flood-src">Source: <a href="' + esc(srcUrl) + '" target="_blank" rel="noopener">' + esc(srcName) + '</a></p>' +
    '</div>';
  }

  function statusMeta(status) {
    switch (status) {
      case STATUS.SUSPENDED:           return { cls: "is-suspended", label: "SUSPENDED", icon: "x-octagon" };
      case STATUS.PARTIALLY_AFFECTED:  return { cls: "is-partial", label: "PARTIALLY AFFECTED", icon: "alert-triangle" };
      case STATUS.PENDING:             return { cls: "is-pending", label: "SCHEDULED", icon: "calendar-clock" };
      case STATUS.UNKNOWN:             return { cls: "is-unknown", label: "UNAVAILABLE", icon: "help-circle" };
      default:                         return { cls: "is-clear", label: "NO SUSPENSION", icon: "check-circle" };
    }
  }
  // Inline status pill for the high-density notice banner. Escapes its value.
  function pill(text, cls) {
    if (text == null || text === "") return "";
    return '<span class="notice-tag ' + (cls || "tag-neutral") + '">' + esc(text) + '</span>';
  }
  var MODALITY_PILL = { FACE_TO_FACE: "Face-to-Face only", ONLINE: "Online only", ALL: "All classes" };
  // "2026-08-17" → "Effective Aug 17". Falls back to the raw string.
  function fmtEffective(d) {
    var mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
    if (!mm) return d ? "Effective " + d : "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return "Effective " + months[+mm[2] - 1] + " " + (+mm[3]);
  }
  // Compact inline pill row replacing the old 8-box metadata grid.
  function noticeTagsHTML(st) {
    var tags = [];
    if (st.scope) tags.push(pill(st.scope, "tag-scope"));
    if (st.affectedLevel) tags.push(pill(st.affectedLevel, "tag-scope"));
    if (st.period && st.period !== "UNKNOWN" && PERIOD_LABEL[st.period]) tags.push(pill(PERIOD_LABEL[st.period], "tag-time"));
    if (st.modality && MODALITY_PILL[st.modality]) {
      var mc = (st.modality === "FACE_TO_FACE" || st.modality === "ONLINE") ? "tag-modality" : "tag-neutral";
      tags.push(pill(MODALITY_PILL[st.modality], mc));
    }
    if (st.effectiveDate) tags.push(pill(fmtEffective(st.effectiveDate), "tag-neutral"));
    if (st.source) tags.push(pill(st.source, "tag-source"));
    var joined = tags.join("");
    return joined ? '<div class="notice-tags">' + joined + '</div>' : "";
  }
  // Split "Fundamentals of Programming (Laboratory)" → { name, type }.
  function parseClassType(subject) {
    var s = String(subject || "");
    var m = s.match(/\(([^)]+)\)\s*$/);
    var type = m ? m[1].trim() : "";
    var name = m ? s.slice(0, m.index).trim() : s.trim();
    return { name: name || s, type: type };
  }
  // Per-class status chip styling + label (matches evaluateClassStatus verdicts).
  function clsChipMeta(v) {
    if (v === "SUSPENDED") return { cls: "is-suspended", label: "Suspended" };
    if (v === "ONLINE_ONLY") return { cls: "is-online", label: "Online only" };
    return { cls: "is-clear", label: "Proceeds" };
  }
  // Live render-time timestamp (truthful — reflects when the panel was drawn).
  function fmtUpdated() {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
      }).format(new Date());
    } catch (e) { return manilaToday(); }
  }

  var PERIOD_LABEL = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening", ALL_DAY: "Whole day", UNKNOWN: "Not specified", SPECIFIC_TIME: "Specific hours" };
  var MODALITY_LABEL = { FACE_TO_FACE: "Face-to-face only", ONLINE: "Online only", ALL: "All classes" };

  function classBreakdownHTML(classes) {
    if (!classes || !classes.length) return "";
    var cards = classes.map(function (c) {
      var chip = clsChipMeta(c.verdict);
      var pt = parseClassType(c.subject);
      var timeRange = fmtClock(c.start) + "–" + fmtClock(c.end);
      return '<div class="cls-card ' + chip.cls + '">' +
        '<div class="cls-top">' +
          '<span class="cls-time">' + esc(timeRange) + '</span>' +
          '<span class="cls-chip ' + chip.cls + '">' + esc(chip.label) + '</span>' +
        '</div>' +
        '<div class="cls-body">' +
          '<span class="cls-name">' + esc(pt.name) + '</span>' +
          (pt.type ? '<span class="cls-type">' + esc(pt.type) + '</span>' : '') +
        '</div>' +
        (c.note ? '<p class="cls-note">' + esc(c.note) + '</p>' : '') +
      '</div>';
    }).join("");
    return '<div class="notice-classes"><p class="notice-classes-h">Your classes today</p><div class="cls-list">' + cards + '</div></div>';
  }

  function officialLinksHTML() {
    return CFG.officialLinks.map(function (l) {
      return '<a class="notice-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
    }).join('<span class="notice-link-sep">·</span>');
  }

  // Official-notice card: color-coded accent bar, high-density inline pill
  // banner, per-class breakdown, live "Last updated" line, and source links.
  function suspensionNoticeHTML(st) {
    var m = statusMeta(st.status);
    var reasonTxt = st.reason && st.status !== STATUS.NOT_SUSPENDED
      ? '<p class="notice-reason"><i data-lucide="info"></i>' + esc(st.reason) + '</p>' : "";
    var body =
      '<div class="notice ' + m.cls + '">' +
        '<div class="notice-bar" aria-hidden="true"></div>' +
        '<div class="notice-main">' +
          '<div class="notice-head">' +
            '<span class="notice-kicker">Class Suspension Notice</span>' +
            '<span class="notice-status"><i data-lucide="' + m.icon + '"></i>' + m.label + '</span>' +
          '</div>' +
          (st.headline ? '<p class="notice-headline">' + esc(st.headline) + '</p>' : '') +
          noticeTagsHTML(st) +
          (st.note ? '<p class="notice-note">' + esc(st.note) + '</p>' : '') +
          reasonTxt +
          (st.confidence && st.status !== STATUS.NOT_SUSPENDED ? '<p class="notice-conf"><span class="notice-conf-dot" aria-hidden="true"></span>Confidence: ' + esc(st.confidence) + '</p>' : '') +
          classBreakdownHTML(st.classes) +
          '<div class="notice-foot">' +
            '<span class="notice-updated"><i data-lucide="refresh-cw"></i>Last updated: ' + esc(fmtUpdated()) + '</span>' +
            '<div class="notice-links">Verify: ' + officialLinksHTML() + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    return body;
  }

  // Small SECONDARY advisory row. Weather NEVER overrides official status.
  function weatherRiskRowHTML(risk, status) {
    if (!risk || risk === "LOW") return "";
    // Only surface advisory when there is no official suspension in effect.
    if (status === STATUS.SUSPENDED || status === STATUS.PARTIALLY_AFFECTED) return "";
    var cls = risk === "SEVERE" ? "is-suspended" : risk === "HIGH" ? "is-partial" : "is-pending";
    return '<div class="wx-risk-row ' + cls + '">' +
      '<span class="wx-risk-bar" aria-hidden="true"></span>' +
      '<span class="wx-risk-body"><strong>Weather-based risk: ' + esc(risk) + '</strong> — not an official announcement. ' +
      'Monitor the links above; only an official notice suspends classes.</span></div>';
  }

  /* =============================================================
     COMPOSE + RENDER
     ============================================================= */
  function paint(html) { root.innerHTML = html; iconify(); }

  function compose(wx, st, flood) {
    return '' +
      '<div class="status-head">' +
        '<span class="home-kicker">Today in ' + esc(CFG.place) + '</span>' +
        '<span class="status-date">' + esc(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "long", month: "short", day: "numeric" }).format(new Date())) + '</span>' +
      '</div>' +
      '<div class="status-grid">' +
        weatherBlockHTML(wx, flood) +
        suspensionNoticeHTML(st) +
      '</div>' +
      weatherRiskRowHTML(st.weatherRisk, st.status);
  }

  function refresh() {
    Promise.all([fetchWeather(), fetchSuspensions(), fetchSchedule(), fetchFlood()]).then(function (res) {
      var wx = res[0], list = res[1], schedule = res[2], flood = res[3];
      var risk = wx ? computeRisk(wx.code, wx.pop) : null;
      var st = getQcuSuspensionStatus(list, schedule, risk);
      paint(compose(wx, st, flood));
    }).catch(function (e) {
      dbg("refresh error", e);
      // Even total failure must not read as "no suspension" / "no flood risk".
      var st = getQcuSuspensionStatus(undefined, [], null);
      paint(compose(null, st, undefined));
    });
  }

  // Loading skeleton, then first paint.
  paint('<div class="status-head"><span class="home-kicker">Today in ' + esc(CFG.place) + '</span></div>' +
        '<div class="status-grid"><div class="wx-panel wx-loading"><span class="wx-status">Loading…</span></div>' +
        '<div class="notice is-unknown"><div class="notice-bar"></div><div class="notice-main">' +
        '<span class="notice-kicker">Class Suspension Notice</span><p class="notice-headline">Checking official sources…</p></div></div></div>');
  refresh();

  // Refresh on tab re-focus (cheap, respects weather TTL cache).
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });

  // Expose the engine for reuse/testing (e.g., ETA page or console).
  window.getQcuSuspensionStatus = function (list, schedule, weatherRisk) {
    return getQcuSuspensionStatus(list, schedule, weatherRisk);
  };
})();

