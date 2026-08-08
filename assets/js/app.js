/* ============================================================
   QCU Student Portal — app.js
   All UI templates and rendering logic.
   Light mode only. No dark mode.
   ============================================================ */

const QCU_DEFAULTS = {
  schedule: [
    { day: "Monday",    start: "11:00", end: "14:00", subject: "Mathematics in the Modern World",       course: "MATH 1", building: "New Academic Building",                       code: "IL", room: "IL502A",    floor: "5th Floor",    units: 3 },
    { day: "Monday",    start: "15:00", end: "17:00", subject: "Fundamentals of Programming (Lecture)", course: "CC102",  building: "New Academic Building",                       code: "IL", room: "IL601A",    floor: "6th Floor",    units: 3 },
    { day: "Monday",    start: "18:00", end: "21:00", subject: "Fundamentals of Programming (Laboratory)", course: "CC102", building: "Bautista Building",                     code: "IK", room: "IK603 F1", floor: "6th Floor",    units: 0 },
    { day: "Tuesday",   noClasses: true },
    { day: "Wednesday", start: "10:00", end: "13:00", subject: "National Service Training Program 1",   course: "NSTP 1", building: "Belmonte Hall",                               code: "SB", room: "SB OG",     floor: "Ground Floor", units: 3 },
    { day: "Wednesday", start: "14:30", end: "17:30", subject: "Introduction to Computing (Laboratory)",course: "CC101",  building: "Bautista Building",                     code: "IK", room: "IK603 F1",  floor: "6th Floor",    units: 0 },
    { day: "Wednesday", start: "19:00", end: "21:00", subject: "Introduction to Computing (Lecture)",   course: "CC101",  building: "New Academic Building",                       code: "IL", room: "IL601A",    floor: "6th Floor",    units: 3 },
    { day: "Thursday",  start: "08:00", end: "11:00", subject: "People and the Earth's Ecosystems",     course: "GEE 2",  building: "New Academic Building",                       code: "IL", room: "IL606A",    floor: "6th Floor",    units: 3 },
    { day: "Thursday",  start: "14:30", end: "17:30", subject: "Gender and Society",                    course: "GEE 1",  building: "New Academic Building",                       code: "IL", room: "IL606A",    floor: "6th Floor",    units: 3 },
    { day: "Friday",    start: "07:00", end: "10:00", subject: "College Algebra",                        course: "MATH 2", building: "New Academic Building",                       code: "IL", room: "IL502A",    floor: "5th Floor",    units: 3 },
    { day: "Friday",    start: "11:30", end: "13:30", subject: "Physical Fitness and Wellness",          course: "PE 1",   building: "Belmonte Hall",                               code: "SB", room: "SB OG",     floor: "Ground Floor", units: 2 }
  ],
  buildings: [
    { code: "IL", name: "New Academic Building",                    image: "New Academic building(1).jpg",   description: "Lecture rooms used for mathematics, programming lectures, computing, and general education courses.", rooms: ["IL502A","IL601A","IL606A"], floors: "5th–6th Floor" },
    { code: "IK", name: "Bautista Building",                      image: "QCU-BUILDING-1024x683-1.jpg",    description: "Laboratory building used for hands-on programming and computing classes.",                             rooms: ["IK603 F1"],              floors: "6th Floor" },
    { code: "SB", name: "Belmonte Hall",                            image: "Belmonte Building 2.jpg",        description: "Campus hall used for NSTP and physical wellness classes at the open ground area.",                     rooms: ["SB OG"],                   floors: "Ground Floor" },
  ]
};

const state = {
  schedule: [...QCU_DEFAULTS.schedule],
  buildings: [...QCU_DEFAULTS.buildings],
  settings: {
    notifications: localStorage.getItem("qcu-notifications") === "true"
  }
};

const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const page = document.body.dataset.page || "home";

/* ── Utils ───────────────────────────────────────────── */
function iconify() { if (window.lucide) window.lucide.createIcons(); }

async function loadJson(path, fallback) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return fallback;
    const t = await r.text();
    if (!t.trim()) return fallback;
    const d = JSON.parse(t);
    return Array.isArray(d) && d.length ? d : fallback;
  } catch { return fallback; }
}

function parseMinutes(v) {
  if (!v) return Number.POSITIVE_INFINITY;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

function minutesNow(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function formatTime(v) {
  if (!v) return "—";
  const [h, m] = v.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDuration(totalSeconds) {
  if (totalSeconds <= 0) return "now";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getStatus(item, now = new Date()) {
  if (item.noClasses) return item.day === dayNames[now.getDay()] ? "today-off" : "inactive";
  const today = dayNames[now.getDay()];
  if (item.day !== today) return "inactive";
  const cur = minutesNow(now);
  const s = parseMinutes(item.start);
  const e = parseMinutes(item.end);
  if (cur >= s && cur < e) return "current";
  if (cur >= e) return "finished";
  const upcoming = state.schedule
    .filter(x => !x.noClasses && x.day === today && parseMinutes(x.start) > cur)
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
  return upcoming[0] === item ? "next" : "upcoming";
}

function getCurrentAndNext(now = new Date()) {
  const today = dayNames[now.getDay()];
  const current = state.schedule.find(x => !x.noClasses && getStatus(x, now) === "current");
  const next = state.schedule
    .filter(x => !x.noClasses && x.day === today && parseMinutes(x.start) > minutesNow(now))
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start))[0];
  return { current, next };
}

function countdownFor(item, now = new Date()) {
  if (!item) return "No class scheduled";
  const startDate = new Date(now);
  const endDate   = new Date(now);
  const [sh, sm] = item.start.split(":").map(Number);
  const [eh, em] = item.end.split(":").map(Number);
  startDate.setHours(sh, sm, 0, 0);
  endDate.setHours(eh, em, 0, 0);
  const status = getStatus(item, now);
  if (status === "current")  return `Ends in ${formatDuration((endDate - now) / 1000)}`;
  if (status === "finished") return "Finished";
  return `Starts in ${formatDuration((startDate - now) / 1000)}`;
}

function statusLabel(s) {
  return { current: "Current", next: "Next", finished: "Finished",
           upcoming: "Upcoming", inactive: "Inactive", "today-off": "No Classes" }[s] || "Upcoming";
}

function statusClass(s) {
  return { current: "status-current", next: "status-next",
           finished: "status-finished", "today-off": "status-off" }[s] || "";
}

function setText(id, val) {
  document.querySelectorAll(`[id="${id}"]`).forEach(n => { n.textContent = val; });
}

function setInnerHTML(el, html) {
  if (!el) return;
  if (el._last === html) return;
  el._last = html;
  el.innerHTML = html;
}

function buildingByCode(code) { return state.buildings.find(b => b.code === code); }

function buildingLabel(item) {
  const b = buildingByCode(item.code);
  return b ? b.name : item.building;
}

function classesForBuilding(code) {
  return state.schedule.filter(x => !x.noClasses && x.code === code);
}

function subjectsForBuilding(code) {
  const seen = new Set(), out = [];
  classesForBuilding(code).forEach(x => {
    if (!seen.has(x.subject)) { seen.add(x.subject); out.push(x.subject); }
  });
  return out;
}

function roomsForBuilding(code) {
  const seen = new Set(), out = [];
  classesForBuilding(code).forEach(x => {
    if (!seen.has(x.room)) { seen.add(x.room); out.push(x.room); }
  });
  return out;
}

const BREAK_MIN = 60;

function formatGap(minutes) {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function dayWithBreaks(day) {
  const classes = [...state.schedule]
    .filter(x => x.day === day && !x.noClasses)
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
  const items = [];
  classes.forEach((x, i) => {
    items.push({ kind: "class", item: x });
    const next = classes[i + 1];
    if (!next) return;
    const gap = parseMinutes(next.start) - parseMinutes(x.end);
    if (gap >= BREAK_MIN) {
      items.push({ kind: "break", start: x.end, end: next.start, minutes: gap });
    }
  });
  return items;
}

function orderedSchedule(now = new Date()) {
  const today = dayNames[now.getDay()];
  return [...state.schedule].sort((a, b) => {
    if (a.day === today && b.day !== today) return -1;
    if (a.day !== today && b.day === today) return 1;
    const dd = dayNames.indexOf(a.day) - dayNames.indexOf(b.day);
    return dd || parseMinutes(a.start) - parseMinutes(b.start);
  });
}

/* ── Shell (header + nav) ────────────────────────────── */
function renderShell() {
  const navItems = [
    ["home",      "index.html",     "layout-dashboard", "Home"],
    ["schedule",  "schedule.html",  "calendar-days",    "Schedule"],
    ["today",     "today.html",     "clock",            "Today"],
    ["buildings", "buildings.html", "building-2",       "Buildings"],
    ["settings",  "settings.html",  "settings",         "Settings"]
  ];

  const header = document.getElementById("app-header");
  if (header) {
    header.innerHTML = `
      <div class="header-inner">
        <a href="index.html" class="header-brand">
          <img class="brand-logo" src="assets/images/QC-App-logo.png" alt="QCU Logo">
          <div class="brand-text">
            <p id="greeting" class="brand-name">QCU Student Portal</p>
            <p class="brand-sub">BS Computer Science · San Bartolome</p>
          </div>
        </a>
        <div class="header-right">
          <div class="header-clock">
            <p id="live-day"  class="clock-day">Today</p>
            <p id="live-date" class="clock-date">Loading…</p>
            <p id="live-time" class="clock-time">00:00</p>
          </div>
          <img class="qc-logo" src="assets/images/Quezon_City_Government.png" alt="QC Government logo">
        </div>
      </div>`;
  }

  const nav = document.getElementById("bottom-nav");
  if (nav) {
    nav.innerHTML = `
      <div>
        ${navItems.map(([key, href, icon, label]) => `
          <a class="nav-item ${page === key ? "active" : ""}"
             href="${href}" aria-label="${label}">
            <i data-lucide="${icon}"></i>
            <span>${label}</span>
          </a>`).join("")}
      </div>`;
  }
}

/* ── Class Card Template ─────────────────────────────── */
function cardTemplate(item) {
  if (item.noClasses) return emptyTemplate("No Classes Scheduled");
  const now    = new Date();
  const status = getStatus(item, now);
  const cd     = countdownFor(item, now);
  const bname  = buildingLabel(item);

  return `
    <article class="portal-card class-card ${status}-card">
      <div class="class-card-top">
        <span class="status-pill ${statusClass(status)}">${statusLabel(status)}</span>
        <span class="class-card-time">${formatTime(item.start)} – ${formatTime(item.end)}</span>
      </div>
      <div>
        <h3 class="class-card-subject">${item.subject}</h3>
        <p style="margin-top:4px; font-size:13px; font-weight:600; color:var(--muted);">${item.course} · ${bname}</p>
        <div style="display:flex; gap:16px; margin-top:12px; padding-top:12px; border-top:1px solid var(--divider);">
          <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Room</p><p style="font-size:13px; font-weight:700;">${item.room}</p></div>
          <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Floor</p><p style="font-size:13px; font-weight:700;">${item.floor}</p></div>
          <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Units</p><p style="font-size:13px; font-weight:700;">${item.units > 0 ? item.units : "Lab"}</p></div>
        </div>
        <p style="margin-top:12px; font-size:13px; font-weight:700; color:var(--blue);"><i data-lucide="timer" style="display:inline-block;width:14px;height:14px;vertical-align:-2px;margin-right:4px;stroke-width:2.2;"></i>${cd}</p>
      </div>
    </article>`;
}

/* ── Empty State ─────────────────────────────────────── */
function emptyTemplate(msg) {
  return `
    <div class="empty-state">
      <i data-lucide="calendar-x-2" class="empty-icon"></i>
      <p class="empty-text">${msg}</p>
    </div>`;
}

function weekOverview(now = new Date()) {
  const counts = {};
  dayNames.forEach(d => { counts[d] = 0; });
  state.schedule.forEach(x => {
    if (!x.noClasses && counts[x.day] !== undefined) counts[x.day] += 1;
  });
  return counts;
}

function weekStripTemplate(now = new Date()) {
  const today = dayNames[now.getDay()];
  const counts = weekOverview(now);
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const max = Math.max(1, ...days.map(d => counts[d] || 0));

  const headRow = days.map(d => `
    <div class="home-week-th">${d.slice(0, 3)}</div>`).join("");

  const bodyRow = days.map(d => {
    const count = counts[d] || 0;
    const pct = Math.round((count / max) * 100);
    const isToday = d === today;
    const isOff = count === 0;
    return `
      <button type="button" class="home-week-td${isToday ? " is-today" : ""}${isOff ? " is-off" : ""}"
        data-day="${d}" aria-label="View ${d}'s schedule">
        <span class="home-week-count">${count || "—"}</span>
        <span class="home-week-track"><span class="home-week-fill" style="width:${pct}%"></span></span>
        <span class="home-week-label">${isToday ? "Today" : count ? `${count} class${count > 1 ? "es" : ""}` : "Off"}</span>
      </button>`;
  }).join("");

  return `
    <div class="home-week-table">
      <div class="home-week-row home-week-head-row">${headRow}</div>
      <div class="home-week-row home-week-body-row">${bodyRow}</div>
    </div>`;
}

function todaySummaryTemplate(todaysClasses, now) {
  const remaining = todaysClasses.filter(x => getStatus(x, now) !== "finished").length;
  const statusText = !todaysClasses.length
    ? "No classes today"
    : remaining === 0
      ? "All finished for the day"
      : remaining === todaysClasses.length
        ? "Full day ahead"
        : `${remaining} still to go`;

  const totalBreak = todaysClasses.reduce((sum, x, i) => {
    const next = todaysClasses[i + 1];
    if (!next) return sum;
    const gap = parseMinutes(next.start) - parseMinutes(x.end);
    return sum + (gap >= BREAK_MIN ? gap : 0);
  }, 0);

  const breakText = totalBreak > 0
    ? `${formatGap(totalBreak)} of break time scheduled`
    : "No scheduled breaks";

  return `
    <article class="home-today-card home-today-summary">
      <span class="home-today-summary-label">Classes today</span>
      <p class="home-today-summary-count">${todaysClasses.length}</p>
      <p class="home-today-summary-sub">${statusText}</p>
      <p class="home-today-summary-break">${breakText}</p>
    </article>`;
}

function todayTileTemplate(item, opts) {
  const status = getStatus(item, new Date());
  const statusWord = { current: "In session", next: "Up next", finished: "Done", upcoming: "Scheduled" }[status] || statusLabel(status);
  const bname = buildingLabel(item);
  const feature = opts.feature ? " home-today-card--feature" : "";
  const stagger = opts.i !== undefined ? ` style="--i:${opts.i}"` : "";

  return `
    <article class="home-today-card ${status}-tile${feature}"${stagger}>
      <div class="home-today-rail">
        <span class="home-today-rail-time">${formatTime(item.start)}</span>
        <span class="home-today-rail-end">${formatTime(item.end)}</span>
        <span class="home-today-rail-rule"></span>
      </div>
      <div class="home-today-body">
        <div class="home-today-head">
          <span class="home-today-status">${statusWord}</span>
          <span class="home-today-course">${item.course}</span>
        </div>
        <h3 class="home-today-subject">${item.subject}</h3>
        <p class="home-today-building">${bname}</p>
        <div class="home-today-meta">
          <span><i data-lucide="map-pin"></i>${item.room}</span>
          <span><i data-lucide="layers"></i>${item.floor}</span>
        </div>
      </div>
    </article>`;
}

function breakTileTemplate(start, end, minutes, i) {
  return `
    <article class="home-break-tile" style="--i:${i || 0}">
      <div class="home-break-rail">
        <span>${formatTime(start)}</span>
        <span>${formatTime(end)}</span>
      </div>
      <div class="home-break-body">
        <span class="home-break-label"><i data-lucide="utensils"></i>Break time</span>
        <p class="home-break-title">Free for ${formatGap(minutes)}</p>
        <p class="home-break-sub">Time to eat, rest, or explore the campus.</p>
      </div>
    </article>`;
}

function trackerCellTemplate(item, label, emptyText, emptyIcon) {
  if (!item) {
    return `
      <span class="home-tracker-empty-icon"><i data-lucide="${emptyIcon || "coffee"}"></i></span>
      <span class="home-tracker-empty">${emptyText}</span>`;
  }
  return `
    <span class="home-tracker-label">${label}</span>
    <p class="home-tracker-subject">${item.subject}</p>
    <p class="home-tracker-time">${formatTime(item.start)} – ${formatTime(item.end)}</p>
    <p class="home-tracker-meta">${buildingLabel(item)} · ${item.room}</p>`;
}

function spotlightTemplate(item, emptyText) {
  if (!item) return `<p class="home-spotlight-empty">${emptyText}</p>`;

  const bname = buildingLabel(item);

  return `
    <div class="home-spotlight">
      <p class="home-spotlight-time">${formatTime(item.start)} <span class="home-spotlight-arrow">→</span> ${formatTime(item.end)}</p>
      <h3 class="home-spotlight-subject">${item.subject}</h3>
      <p class="home-spotlight-meta">${bname} · ${item.room} · ${item.floor}</p>
    </div>`;
}

function countdownTemplate(item, label) {
  if (!item) {
    return `<div class="home-countdown-empty">${label}</div>`;
  }

  const now = new Date();
  const status = getStatus(item, now);

  if (status === "current") {
    const end = new Date(now);
    const [eh, em] = item.end.split(":").map(Number);
    end.setHours(eh, em, 0, 0);
    const remaining = Math.max(0, Math.floor((end - now) / 1000));
    const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
    const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");

    const [sh, sm] = item.start.split(":").map(Number);
    const totalMin = Math.max(1, (eh * 60 + em) - (sh * 60 + sm));
    const elapsedMin = Math.max(0, minutesNow(now) - (sh * 60 + sm));
    const pct = Math.min(100, (elapsedMin / totalMin) * 100);

    return `
      <div class="home-countdown-value">${hh}:${mm}:${ss}</div>
      <p class="home-countdown-label">until ${item.subject} ends</p>
      <div class="home-countdown-track"><span class="home-countdown-fill" style="width:${pct}%"></span></div>`;
  }

  if (status === "finished") {
    return `<div class="home-countdown-empty">Class finished</div>`;
  }

  const start = new Date(now);
  const [sh, sm] = item.start.split(":").map(Number);
  start.setHours(sh, sm, 0, 0);
  const remaining = Math.max(0, Math.floor((start - now) / 1000));
  const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return `
    <div class="home-countdown-value">${hh}:${mm}:${ss}</div>
    <p class="home-countdown-label">until next class starts</p>
    <p class="home-countdown-target">${item.subject}</p>
    <p class="home-countdown-subject">${formatTime(item.start)} – ${formatTime(item.end)}</p>`;
}

/* ── Home Page ───────────────────────────────────────── */
function renderHome() {
  const now = new Date();
  const today = dayNames[now.getDay()];
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todaysClasses = state.schedule.filter(x => x.day === today && !x.noClasses);
  const { current, next } = getCurrentAndNext(now);
  const currentLabel = current ? "In session" : "No class right now";
  const nextLabel = next ? "Coming up next" : (todaysClasses.length ? "No more classes today" : "No classes today");

  setText("home-greeting", `${greeting}, Habib`);
  setText("hero-class-count", `${todaysClasses.length}`);
  setText("hero-today-date", now.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }));

  const weekEl = document.getElementById("home-week-strip");
  if (weekEl) setInnerHTML(weekEl, weekStripTemplate(now));

  const grid = document.getElementById("today-grid");
  if (grid) {
    const feature = current || next;
    // Build today's timeline with break slots between classes
    const timeline = dayWithBreaks(today);
    let classIndex = 0;
    let breakIndex = 0;
    const tiles = timeline.map(entry => {
      if (entry.kind === "class") {
        const item = entry.item;
        const tile = todayTileTemplate(item, { feature: item === feature, i: classIndex });
        classIndex++;
        return tile;
      } else {
        const tile = breakTileTemplate(entry.start, entry.end, entry.minutes, breakIndex);
        breakIndex++;
        return tile;
      }
    });
    setInnerHTML(grid, [
      todaySummaryTemplate(todaysClasses, now),
      ...tiles
    ].join(""));
  }

  const countdownTarget = current || next;
  const countdownLabel = current ? "Ongoing class" : next ? "Next class starts in" : "No upcoming classes today";
  const activeNow = (current ? 1 : 0) + (next ? 1 : 0);
  setText("countdown-state-label", current ? "In session" : next ? "Upcoming" : "No classes left");

const trackerRoot = document.getElementById("home-tracker");
  const nowEl = document.getElementById("tracker-now");
  const nextEl = document.getElementById("tracker-next");

  // No classes at all today OR all classes finished → collapse into a single full-width empty state.
  if (!current && !next) {
    if (trackerRoot) {
      trackerRoot.classList.add("home-tracker--empty");
      const allDone = todaysClasses.length > 0;
      setInnerHTML(trackerRoot, `
        <div class="home-tracker-empty-panel">
          <div class="home-tracker-empty-icon-wrap">
            <span class="home-tracker-empty-icon"><i data-lucide="${allDone ? "check-circle-2" : "coffee"}"></i></span>
          </div>
          <div class="home-tracker-empty-text">
            <p class="home-tracker-empty-title">${allDone ? "No classes left" : "No classes today"}</p>
            <p class="home-tracker-empty-sub">${allDone ? "All classes are done for the day — enjoy your free time." : "You're all caught up — enjoy your free day."}</p>
          </div>
          <a class="home-tracker-empty-link" href="schedule.html">
            View full schedule
            <i data-lucide="arrow-right"></i>
          </a>
        </div>`);
    }
  } else {
    if (trackerRoot) trackerRoot.classList.remove("home-tracker--empty");
    if (nowEl) setInnerHTML(nowEl, trackerCellTemplate(current, "In session", "No class right now", "clock"));
    if (nextEl) setInnerHTML(nextEl, trackerCellTemplate(next, "Coming up next",
      todaysClasses.length ? "No more classes today" : "No classes today", "coffee"));
  }

  const countdownEl = document.getElementById("countdown-slot");
  if (countdownEl) countdownEl.innerHTML = countdownTemplate(countdownTarget, countdownLabel);

  const nowNext = document.getElementById("now-next-list");
  if (nowNext) {
    setInnerHTML(nowNext, `
      ${current ? spotlightTemplate(current, "") : ""}
      ${next && next !== current ? spotlightTemplate(next, "") : ""}
    `);
  }
}

/* ── Day Modal (weekly overview) ─────────────────────── */
function classesForDay(day) {
  return state.schedule
    .filter(x => x.day === day && !x.noClasses)
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
}

function openDayModal(day) {
  const modal   = document.getElementById("day-modal");
  const content = document.getElementById("day-modal-content");
  if (!modal || !content) return;

  const classes = classesForDay(day);
  const isToday = day === dayNames[new Date().getDay()];
  const hours = classes.reduce((sum, x) => sum + (parseMinutes(x.end) - parseMinutes(x.start)) / 60, 0);

  const rows = classes.length
    ? classes.map(x => {
        const bname = buildingLabel(x);
        return `
          <div class="day-modal-row">
            <div class="day-modal-time">
              <span class="day-modal-start">${formatTime(x.start)}</span>
              <span class="day-modal-to">→</span>
              <span class="day-modal-end">${formatTime(x.end)}</span>
            </div>
            <div class="day-modal-main">
              <span class="day-modal-subject">${x.subject}</span>
              <span class="day-modal-meta">${bname} · ${x.room} · ${x.floor}</span>
            </div>
            <span class="day-modal-course">${x.course}</span>
          </div>`;
      }).join("")
    : `<div class="day-modal-state">No classes scheduled on ${day}.</div>`;

  content.innerHTML = `
    <div class="modal-drag-handle"></div>
    <div class="modal-inner">
      <div class="modal-head">
        <div>
          <span class="chip chip-blue" style="margin-bottom:8px;display:inline-flex;">${isToday ? "Today" : day}</span>
          <h2 class="modal-title">${day}'s classes</h2>
        </div>
        <button class="modal-close-btn" data-close-modal aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>

      <div class="day-modal-stats">
        <div class="day-modal-stat">
          <span class="day-modal-stat-label">Classes</span>
          <span class="day-modal-stat-value">${classes.length}</span>
        </div>
        <div class="day-modal-stat">
          <span class="day-modal-stat-label">Hours</span>
          <span class="day-modal-stat-value">${Math.round(hours * 10) / 10}</span>
        </div>
      </div>

      <div class="day-modal-rows">${rows}</div>
    </div>`;

  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
}

/* ── Schedule Page ───────────────────────────────────── */
function dayShort(day) {
  return day.slice(0, 3);
}

function buildingShort(item) {
  const b = buildingByCode(item.code);
  if (!b) return item.building;
  const name = b.name;
  if (name.includes("New Academic")) return "New Acad Bldg";
  if (name.includes("Bautista"))     return "Bautista Bldg";
  if (name.includes("Belmonte"))     return "Belmonte Hall";
  return name;
}

function floorShort(floor) {
  if (!floor) return "";
  if (floor.includes("Ground")) return "GF";
  const m = floor.match(/(\d+)/);
  return m ? `${m[1]}F` : floor;
}

function renderSchedule() {
  const rows = document.getElementById("schedule-rows");
  if (!rows) return;
  const now   = new Date();
  const today = dayNames[now.getDay()];

  // Build rows with break/free periods between classes on the same day
  const html = [];
  let lastDay = null;
  let lastEnd = null;

  orderedSchedule(now).forEach(item => {
    const status  = getStatus(item, now);
    const isToday = item.day === today;
    const rowClass = [`${status}-row`, isToday ? "today-row" : "", item.noClasses ? "no-class-row" : ""]
      .filter(Boolean).join(" ");

    // Insert break row between consecutive classes on the same day with gap >= BREAK_MIN
    if (!item.noClasses && lastDay === item.day && lastEnd !== null) {
      const gap = parseMinutes(item.start) - lastEnd;
      if (gap >= BREAK_MIN) {
        html.push(`
          <tr class="break-row">
            <td data-label="Time" colspan="6" style="text-align:center;">
              <span class="break-free-label">FREE</span>
              ${formatTime(minutesToTime(lastEnd))} – ${formatTime(item.start)}
              <span class="break-duration">· ${formatGap(gap)} break</span>
            </td>
          </tr>`);
      }
    }

    if (item.noClasses) {
      html.push(`
        <tr class="${rowClass}">
          <td data-label="Time"    class="time-cell">${dayShort(item.day)}</td>
          <td data-label="Subject" class="subject-cell font-bold">No Classes Scheduled</td>
          <td data-label="Code">—</td>
          <td data-label="Location">—</td>
          <td data-label="Units">—</td>
          <td data-label="Status"><span class="status-dot status-dot-off" title="No Classes"></span></td>
        </tr>`);
    } else {
      const bname = buildingShort(item);
      const loc = `${bname} · ${floorShort(item.floor)} · ${item.room}`;
      html.push(`
        <tr class="${rowClass}">
          <td data-label="Time" class="time-cell">
            <span class="day-abbr">${dayShort(item.day)}</span>
            <span class="time-range">${formatTime(item.start)} – ${formatTime(item.end)}</span>
          </td>
          <td data-label="Subject" class="subject-cell">${item.subject}</td>
          <td data-label="Code"><span class="code-cell">${item.course || "—"}</span></td>
          <td data-label="Location" class="location-cell">${loc}</td>
          <td data-label="Units"><span class="units-chip">${item.units > 0 ? item.units : "Lab"}</span></td>
          <td data-label="Status"><span class="status-dot status-dot-${status}" title="${statusLabel(status)}"></span></td>
        </tr>`);
      lastDay = item.day;
      lastEnd = parseMinutes(item.end);
    }
  });

  rows.innerHTML = html.join("");
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeShort(v) {
  if (!v) return "—";
  const [h, m] = v.split(":").map(Number);
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")}`;
}

/* ── Today Page ──────────────────────────────────────── */
function renderToday() {
  const list = document.getElementById("today-cards");
  if (!list) return;
  const today = dayNames[new Date().getDay()];
  const todaysClasses = state.schedule.filter(x => x.day === today);
  list.innerHTML = todaysClasses.length
    ? todaysClasses.map(cardTemplate).join("")
    : emptyTemplate("No classes scheduled today");
}

/* ── Buildings Page ──────────────────────────────────── */
function renderBuildings() {
  const grid = document.getElementById("building-grid");
  if (!grid) return;

  grid.innerHTML = state.buildings.map((item, index) => {
    const classCount = classesForBuilding(item.code).length;
    const subjects   = subjectsForBuilding(item.code);
    const rooms      = roomsForBuilding(item.code).length ? roomsForBuilding(item.code) : item.rooms;

    return `
      <button class="building-card" data-building-index="${index}" type="button">
        <div class="building-card-image">
          <img src="assets/images/${item.image}" alt="${item.name}" loading="lazy">
          <span class="building-code-badge">${item.code}</span>
        </div>
        <div class="building-card-body">
          <p class="building-name">${item.name}</p>
          <p class="building-desc">${item.description}</p>
          <div style="display:flex; gap:16px; margin-top:8px; padding-top:12px; border-top:1px solid var(--divider);">
            <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Floors</p><p style="font-size:13px; font-weight:700;">${item.floors}</p></div>
            <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Rooms</p><p style="font-size:13px; font-weight:700;">${rooms.length}</p></div>
            <div><p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Classes</p><p style="font-size:13px; font-weight:700;">${classCount}</p></div>
          </div>
          ${subjects.length ? `
            <div style="margin-top:8px;">
              <p style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Subjects</p>
              <p style="font-size:12px; font-weight:600; color:var(--text); line-height:1.4;">${subjects.join(", ")}</p>
            </div>` : ""}
        </div>
      </button>`;
  }).join("");

  grid.onclick = (e) => {
    const btn = e.target.closest("[data-building-index]");
    if (btn) openBuildingModal(state.buildings[Number(btn.dataset.buildingIndex)]);
  };
}

/* ── Building Modal ──────────────────────────────────── */
function openBuildingModal(building) {
  const modal   = document.getElementById("building-modal");
  const content = document.getElementById("building-modal-content");
  if (!modal || !content) return;

  const subjects    = subjectsForBuilding(building.code);
  const rooms       = roomsForBuilding(building.code).length ? roomsForBuilding(building.code) : building.rooms;
  const classCount  = classesForBuilding(building.code).length;

  content.innerHTML = `
    <div class="modal-drag-handle"></div>
    <div class="modal-inner">
      <div class="modal-head">
        <div>
          <span class="chip chip-blue" style="margin-bottom:8px;display:inline-flex;">${building.code}</span>
          <h2 class="modal-title">${building.name}</h2>
        </div>
        <button class="modal-close-btn" data-close-modal aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>

      <div class="building-modal-image">
        <img src="assets/images/${building.image}" alt="${building.name}">
      </div>

      <p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:14px;">${building.description}</p>

      <div class="modal-info-grid">
        <div class="modal-info-cell">
          <p class="modal-info-label">Floors</p>
          <p class="modal-info-value">${building.floors}</p>
        </div>
        <div class="modal-info-cell">
          <p class="modal-info-label">Rooms</p>
          <p class="modal-info-value">${rooms.length ? rooms.join(", ") : "—"}</p>
        </div>
        <div class="modal-info-cell">
          <p class="modal-info-label">Classes / Week</p>
          <p class="modal-info-value">${classCount}</p>
        </div>
      </div>

      ${subjects.length ? `
        <div>
          <p style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Subjects</p>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${subjects.map(s => `<span class="chip chip-gray">${s}</span>`).join("")}
          </div>
        </div>` : ""}
    </div>`;

  modal.classList.add("open");
  document.body.classList.add("modal-open");
  iconify();
}

function closeModal() {
  document.getElementById("building-modal")?.classList.remove("open");
  document.getElementById("day-modal")?.classList.remove("open");
  document.body.classList.remove("modal-open");
}

/* ── Settings Page ───────────────────────────────────── */
function renderSettings() {
  const notifToggle = document.getElementById("notifications-toggle");
  if (notifToggle) {
    notifToggle.checked = state.settings.notifications;
    notifToggle.addEventListener("change", async () => {
      if (notifToggle.checked && "Notification" in window) {
        const perm = await Notification.requestPermission();
        state.settings.notifications = perm === "granted";
        notifToggle.checked = state.settings.notifications;
      } else {
        state.settings.notifications = false;
      }
      localStorage.setItem("qcu-notifications", String(state.settings.notifications));
    });
  }

  document.getElementById("reset-data")?.addEventListener("click", () => {
    localStorage.removeItem("qcu-notifications");
    location.reload();
  });
}

/* ── Clock ───────────────────────────────────────────── */
function updateClock() {
  const now  = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  setText("live-time", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
  setText("live-day",  dayNames[now.getDay()]);
  setText("live-date", now.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }));
  setText("greeting",  `${greeting}, Habib`);
}

/* ── Tick ────────────────────────────────────────────── */
function tick() {
  updateClock();
  if (page === "home")     renderHome();
  if (page === "schedule") renderSchedule();
  if (page === "today")    renderToday();
}

/* ── Init ────────────────────────────────────────────── */
async function init() {
  state.schedule  = await loadJson("data/schedule.json",  QCU_DEFAULTS.schedule);
  state.buildings = await loadJson("data/buildings.json", QCU_DEFAULTS.buildings);

  renderShell();
  tick();

  if (page === "buildings") renderBuildings();
  if (page === "settings")  renderSettings();

  ["building-modal", "day-modal"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", e => {
        if (e.target.id === id || e.target.closest("[data-close-modal]")) closeModal();
      });
    }
  });

  document.getElementById("home-week-strip")?.addEventListener("click", e => {
    const cell = e.target.closest("[data-day]");
    if (cell) openDayModal(cell.dataset.day);
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  iconify();
  setInterval(tick, 1000);
}

init();
