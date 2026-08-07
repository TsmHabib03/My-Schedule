const QCU_DEFAULTS = {
  schedule: [
    { day: "Monday", start: "11:00", end: "14:00", subject: "Mathematics in the Modern World", course: "MATH 1", building: "New Academic Building", code: "IL", room: "IL502A", floor: "5th Floor", units: 3 },
    { day: "Monday", start: "15:00", end: "17:00", subject: "Fundamentals of Programming (Lecture)", course: "CC102", building: "New Academic Building", code: "IL", room: "IL601A", floor: "6th Floor", units: 3 },
    { day: "Monday", start: "18:00", end: "21:00", subject: "Fundamentals of Programming (Laboratory)", course: "CC102", building: "Techboc Building (Helbert Bautista TechVoc)", code: "HB", room: "IK603 F1", floor: "6th Floor", units: 0 },
    { day: "Tuesday", noClasses: true },
    { day: "Wednesday", start: "10:00", end: "13:00", subject: "National Service Training Program 1", course: "NSTP 1", building: "Belmonte Hall", code: "SB", room: "SB OG", floor: "Ground Floor", units: 3 },
    { day: "Wednesday", start: "14:30", end: "17:30", subject: "Introduction to Computing (Laboratory)", course: "CC101", building: "Techboc Building (Helbert Bautista TechVoc)", code: "HB", room: "IK603 F1", floor: "6th Floor", units: 0 },
    { day: "Wednesday", start: "19:00", end: "21:00", subject: "Introduction to Computing (Lecture)", course: "CC101", building: "New Academic Building", code: "IL", room: "IL601A", floor: "6th Floor", units: 3 },
    { day: "Thursday", start: "08:00", end: "11:00", subject: "People and the Earth's Ecosystems", course: "GEE 2", building: "New Academic Building", code: "IL", room: "IL606A", floor: "6th Floor", units: 3 },
    { day: "Thursday", start: "14:30", end: "17:30", subject: "Gender and Society", course: "GEE 1", building: "New Academic Building", code: "IL", room: "IL606A", floor: "6th Floor", units: 3 },
    { day: "Friday", start: "07:00", end: "10:00", subject: "College Algebra", course: "MATH 2", building: "New Academic Building", code: "IL", room: "IL502A", floor: "5th Floor", units: 3 },
    { day: "Friday", start: "11:30", end: "13:30", subject: "Physical Fitness and Wellness", course: "PE 1", building: "Belmonte Hall", code: "SB", room: "SB OG", floor: "Ground Floor", units: 2 }
  ],
  buildings: [
    { code: "IL", name: "New Academic Building", image: "New Academic building(1).jpg", description: "Lecture rooms used for mathematics, programming lectures, computing, and general education courses.", rooms: ["IL502A", "IL601A", "IL606A"], floors: "5th to 6th Floor" },
    { code: "IK", name: "Bautista Building", image: "QCU-BUILDING-1024x683-1.jpg", description: "Campus building at the San Bartolome campus serving general academic purposes.", rooms: [], floors: "—" },
    { code: "SB", name: "Belmonte Hall", image: "Belmonte Building 2.jpg", description: "Campus hall used for NSTP and physical wellness classes at the open ground area.", rooms: ["SB OG"], floors: "Ground Floor" },
    { code: "HB", name: "Techboc Building (Helbert Bautista TechVoc)", image: "Techboc HB bautista.jpg", description: "Specialized technology and computing laboratory building for hands-on programming and computing classes.", rooms: ["IK603 F1"], floors: "6th Floor" }
  ]
};

const state = {
  schedule: [...QCU_DEFAULTS.schedule],
  buildings: [...QCU_DEFAULTS.buildings],
  settings: {
    theme: localStorage.getItem("qcu-theme") || "light",
    notifications: localStorage.getItem("qcu-notifications") === "true"
  }
};

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const page = document.body.dataset.page || "home";

function iconify() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return fallback;
    const text = await response.text();
    if (!text.trim()) return fallback;
    const data = JSON.parse(text);
    return Array.isArray(data) && data.length ? data : fallback;
  } catch {
    return fallback;
  }
}

function parseMinutes(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesNow(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function formatTime(value) {
  if (!value) return "No Classes";
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDuration(totalSeconds) {
  if (totalSeconds <= 0) return "now";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getStatus(item, now = new Date()) {
  if (item.noClasses) return item.day === dayNames[now.getDay()] ? "today-off" : "inactive";
  const today = dayNames[now.getDay()];
  if (item.day !== today) return "inactive";
  const current = minutesNow(now);
  const start = parseMinutes(item.start);
  const end = parseMinutes(item.end);
  if (current >= start && current < end) return "current";
  if (current >= end) return "finished";
  const todayClasses = state.schedule
    .filter((entry) => !entry.noClasses && entry.day === today && parseMinutes(entry.start) > current)
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
  return todayClasses[0] === item ? "next" : "upcoming";
}

function getCurrentAndNext(now = new Date()) {
  const today = dayNames[now.getDay()];
  const current = state.schedule.find((item) => !item.noClasses && getStatus(item, now) === "current");
  const next = state.schedule
    .filter((item) => !item.noClasses && item.day === today && parseMinutes(item.start) > minutesNow(now))
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start))[0];
  return { current, next };
}

function countdownFor(item, now = new Date()) {
  if (!item) return "No class scheduled";
  const startDate = new Date(now);
  const endDate = new Date(now);
  const [startHour, startMinute] = item.start.split(":").map(Number);
  const [endHour, endMinute] = item.end.split(":").map(Number);
  startDate.setHours(startHour, startMinute, 0, 0);
  endDate.setHours(endHour, endMinute, 0, 0);
  const status = getStatus(item, now);
  if (status === "current") return `Ends in ${formatDuration((endDate - now) / 1000)}`;
  if (status === "finished") return "Finished";
  return `Starts in ${formatDuration((startDate - now) / 1000)}`;
}

function statusLabel(status) {
  return {
    current: "Current",
    next: "Next",
    finished: "Finished",
    upcoming: "Upcoming",
    inactive: "Inactive",
    "today-off": "No Classes"
  }[status] || "Upcoming";
}

function statusClass(status) {
  return {
    current: "status-current",
    next: "status-next",
    finished: "status-finished",
    "today-off": "status-off",
    upcoming: "",
    inactive: ""
  }[status] || "";
}

function setText(id, value) {
  document.querySelectorAll(`[id="${id}"]`).forEach((node) => {
    node.textContent = value;
  });
}

function buildingByCode(code) {
  return state.buildings.find((b) => b.code === code);
}

function buildingLabel(item) {
  const b = buildingByCode(item.code);
  return b ? `${b.name} (${b.code})` : `${item.building} (${item.code})`;
}

function classesForBuilding(code) {
  return state.schedule.filter((entry) => !entry.noClasses && entry.code === code);
}

function subjectsForBuilding(code) {
  const seen = new Set();
  const subjects = [];
  classesForBuilding(code).forEach((entry) => {
    if (!seen.has(entry.subject)) {
      seen.add(entry.subject);
      subjects.push(entry.subject);
    }
  });
  return subjects;
}

function roomsForBuilding(code) {
  const seen = new Set();
  const rooms = [];
  classesForBuilding(code).forEach((entry) => {
    if (!seen.has(entry.room)) {
      seen.add(entry.room);
      rooms.push(entry.room);
    }
  });
  return rooms;
}

function orderedSchedule(now = new Date()) {
  const today = dayNames[now.getDay()];
  return [...state.schedule].sort((a, b) => {
    if (a.day === today && b.day !== today) return -1;
    if (a.day !== today && b.day === today) return 1;
    const dayDiff = dayNames.indexOf(a.day) - dayNames.indexOf(b.day);
    return dayDiff || parseMinutes(a.start) - parseMinutes(b.start);
  });
}

function renderShell() {
  const navItems = [
    ["home", "index.html", "layout-dashboard", "Home"],
    ["schedule", "schedule.html", "calendar-days", "Schedule"],
    ["buildings", "buildings.html", "building-2", "Buildings"],
    ["settings", "settings.html", "settings", "Settings"]
  ];

  const header = document.getElementById("app-header");
  if (header) {
    header.innerHTML = `
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <a href="index.html" class="flex min-w-0 items-center gap-3 text-inherit no-underline">
          <img class="brand-logo shrink-0" src="assets/images/cropped-logo.jpg" alt="Quezon City University logo">
          <div class="min-w-0">
            <p id="greeting" class="truncate text-[15px] font-extrabold leading-tight">Good day, Habib</p>
            <p class="truncate text-[13px] font-semibold text-[color:var(--muted)]">BS Computer Science</p>
            <p class="truncate text-[13px] font-semibold text-[color:var(--muted)]">San Bartolome Campus</p>
          </div>
        </a>
        <div class="flex shrink-0 items-center gap-3 text-right">
          <div>
            <p id="live-day" class="text-[13px] font-bold text-[color:var(--muted)]">Today</p>
            <p id="live-date" class="hidden text-[13px] font-semibold text-[color:var(--muted)] sm:block">Loading date</p>
            <p id="live-time" class="text-[15px] font-extrabold text-[color:var(--blue)]">00:00</p>
          </div>
          <img class="qc-logo" src="assets/images/Quezon_City_Government.png" alt="Quezon City Government logo">
        </div>
      </div>
    `;
  }

  const nav = document.getElementById("bottom-nav");
  if (nav) {
    nav.innerHTML = `
      <div class="flex items-center justify-around">
        ${navItems.map(([key, href, icon, label]) => `
          <a class="nav-item ${page === key ? "active" : ""}" href="${href}" aria-label="${label}">
            <i data-lucide="${icon}"></i><span>${label}</span>
          </a>`).join("")}
      </div>
    `;
  }
}

function renderHome() {
  const now = new Date();
  const today = dayNames[now.getDay()];
  const todaysClasses = state.schedule.filter((item) => item.day === today && !item.noClasses);
  const { current, next } = getCurrentAndNext(now);
  const activeSubject = current || next;
  setText("current-subject", current ? current.subject : "No class right now");
  setText("next-subject", next ? next.subject : todaysClasses.length ? "No more classes today" : "No Classes");
  setText("hero-countdown", activeSubject ? countdownFor(activeSubject, now) : todaysClasses.length ? "Classes finished" : "No Classes");
  setText("upcoming-class", next ? `${formatTime(next.start)} at ${next.room}` : "Nothing upcoming");

  const finished = todaysClasses.filter((item) => getStatus(item, now) === "finished").length;
  const progress = todaysClasses.length ? Math.round((finished / todaysClasses.length) * 100) : 100;
  const bar = document.getElementById("daily-progress");
  if (bar) bar.style.width = `${progress}%`;
  setText("daily-progress-label", `${progress}% complete`);

  const list = document.getElementById("today-list");
  if (list) {
    list.innerHTML = todaysClasses.length ? todaysClasses.map(cardTemplate).join("") : emptyTemplate("No classes scheduled today");
  }

  const weekly = document.getElementById("weekly-overview");
  if (weekly) {
    weekly.innerHTML = dayNames.slice(1, 6).map((day) => {
      const dayClasses = state.schedule.filter((item) => item.day === day && !item.noClasses);
      const count = dayClasses.length;
      const isToday = day === today;
      const active = isToday ? "active" : "";
      const noClasses = !count;
      return `
      <div class="weekday-tab ${active} ${noClasses ? "no-classes" : ""}" aria-current="${isToday ? "date" : "false"}">
        <span class="weekday-name">${day.slice(0, 3)}</span>
        ${noClasses
          ? `<span class="weekday-note">No Classes</span>`
          : `<span class="weekday-count">${count} class${count !== 1 ? "es" : ""}</span>
             <span class="weekday-time">${formatTime(dayClasses[0].start)}</span>`}
      </div>`;
    }).join("");
  }
}

function renderSchedule() {
  const rows = document.getElementById("schedule-rows");
  if (!rows) return;
  const now = new Date();
  const today = dayNames[now.getDay()];
  rows.innerHTML = orderedSchedule(now).map((item) => {
    const status = getStatus(item, now);
    const isToday = item.day === today;
    const rowClass = [
      `${status}-row`,
      isToday ? "today-row" : "",
      item.noClasses ? "no-class-row" : ""
    ].filter(Boolean).join(" ");

    if (item.noClasses) {
      return `
      <tr class="${rowClass}">
        <td data-label="Day" class="font-bold">${item.day}</td>
        <td data-label="Time">No Classes</td>
        <td data-label="Subject" class="font-bold">No Classes</td>
        <td data-label="Code">-</td>
        <td data-label="Building">-</td>
        <td data-label="Room">-</td>
        <td data-label="Floor">-</td>
        <td data-label="Units">-</td>
        <td data-label="Status"><span class="status-pill status-off">No Classes</span></td>
      </tr>`;
    }

    const buildingText = buildingLabel(item);
    return `
      <tr class="${rowClass}">
        <td data-label="Day" class="font-bold">${item.day}</td>
        <td data-label="Time" class="time-cell">${formatTime(item.start)} – ${formatTime(item.end)}</td>
        <td data-label="Subject"><span class="subject-cell">${item.subject}</span></td>
        <td data-label="Code"><span class="code-cell">${item.course || "-"}</span></td>
        <td data-label="Building"><span class="building-cell">${buildingText}</span></td>
        <td data-label="Room"><span class="room-cell">${item.room}</span></td>
        <td data-label="Floor">${item.floor}</td>
        <td data-label="Units">${item.units}</td>
        <td data-label="Status"><span class="status-pill ${statusClass(status)}">${statusLabel(status)}</span></td>
      </tr>`;
  }).join("");
}

function cardTemplate(item) {
  if (item.noClasses) return emptyTemplate("No Classes");
  const now = new Date();
  const status = getStatus(item, now);
  const buildingText = buildingLabel(item);
  return `
    <article class="portal-card class-card ${status}-card">
      <div class="class-card-top">
        <span class="status-pill ${statusClass(status)}">${statusLabel(status)}</span>
        <span class="time-cell font-bold">${formatTime(item.start)} – ${formatTime(item.end)}</span>
      </div>
      <h3 class="card-title mt-2">${item.subject}</h3>
      <p class="mt-1 text-sm font-semibold text-[color:var(--muted)]">${item.course} · ${buildingText}</p>
      <div class="class-meta mt-4">
        <div><p class="text-muted">Room</p><p class="font-bold">${item.room}</p></div>
        <div><p class="text-muted">Floor</p><p class="font-bold">${item.floor}</p></div>
        <div><p class="text-muted">Units</p><p class="font-bold">${item.units}</p></div>
      </div>
      <p class="mt-4 text-sm font-bold text-[color:var(--blue)]">${countdownFor(item, now)}</p>
    </article>`;
}

function renderToday() {
  const list = document.getElementById("today-cards");
  if (!list) return;
  const today = dayNames[new Date().getDay()];
  const todaysClasses = state.schedule.filter((item) => item.day === today);
  list.innerHTML = todaysClasses.length ? todaysClasses.map(cardTemplate).join("") : emptyTemplate("No classes scheduled today");
}

function renderBuildings() {
  const grid = document.getElementById("building-grid");
  if (!grid) return;
  grid.innerHTML = state.buildings.map((item, index) => {
    const classCount = classesForBuilding(item.code).length;
    const subjects = subjectsForBuilding(item.code);
    const rooms = roomsForBuilding(item.code).length ? roomsForBuilding(item.code) : item.rooms;
    return `
    <button class="portal-card building-card block w-full text-left" data-building-index="${index}">
      <div class="building-card-image">
        <img src="assets/images/${item.image}" alt="${item.name}" loading="lazy">
      </div>
      <div class="building-card-body">
        <span class="status-pill">${item.code}</span>
        <h2 class="card-title mt-3">${item.name}</h2>
        <p class="mt-2 text-sm leading-6 text-[color:var(--muted)]">${item.description}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <span class="status-pill">${item.floors}</span>
          <span class="status-pill">${rooms.length} room${rooms.length !== 1 ? "s" : ""}</span>
          <span class="status-pill">${classCount} class${classCount !== 1 ? "es" : ""}/wk</span>
        </div>
        ${subjects.length ? `
        <div class="mt-4">
          <p class="caption">Subjects</p>
          <div class="mt-2 flex flex-wrap gap-2">${subjects.map((subject) => `<span class="status-pill">${subject}</span>`).join("")}</div>
        </div>` : ""}
      </div>
    </button>
  `;
  }).join("");
  grid.querySelectorAll("[data-building-index]").forEach((button) => {
    button.addEventListener("click", () => openBuildingModal(state.buildings[Number(button.dataset.buildingIndex)]));
  });
}

function openBuildingModal(building) {
  const modal = document.getElementById("building-modal");
  const content = document.getElementById("building-modal-content");
  if (!modal || !content) return;
  const subjects = subjectsForBuilding(building.code);
  const rooms = roomsForBuilding(building.code).length ? roomsForBuilding(building.code) : building.rooms;
  const classCount = classesForBuilding(building.code).length;
  content.innerHTML = `
    <div class="building-modal-head">
      <div>
        <span class="status-pill">${building.code}</span>
        <h2 class="page-title mt-3">${building.name}</h2>
      </div>
      <button class="action-button secondary !min-h-10 !px-3" data-close-modal aria-label="Close"><i data-lucide="x"></i></button>
    </div>
    <div class="building-modal-image mt-4">
      <img src="assets/images/${building.image}" alt="${building.name}">
    </div>
    <p class="mt-4 leading-7 text-[color:var(--muted)]">${building.description}</p>
    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      <div class="portal-card !p-4"><p class="text-sm text-[color:var(--muted)]">Floors</p><p class="mt-1 font-bold">${building.floors}</p></div>
      <div class="portal-card !p-4"><p class="text-sm text-[color:var(--muted)]">Rooms</p><p class="mt-1 font-bold">${rooms.length ? rooms.join(", ") : "—"}</p></div>
      <div class="portal-card !p-4"><p class="text-sm text-[color:var(--muted)]">Classes/Week</p><p class="mt-1 font-bold">${classCount}</p></div>
    </div>
    ${subjects.length ? `
    <div class="mt-5">
      <p class="font-bold">Subjects</p>
      <div class="mt-3 flex flex-wrap gap-2">${subjects.map((subject) => `<span class="status-pill">${subject}</span>`).join("")}</div>
    </div>` : ""}
  `;
  modal.classList.add("open");
  modal.querySelector("[data-close-modal]").addEventListener("click", closeModal);
  iconify();
}

function closeModal() {
  const modal = document.getElementById("building-modal");
  if (modal) modal.classList.remove("open");
}

function renderSettings() {
  const theme = document.getElementById("theme-toggle");
  const notifications = document.getElementById("notifications-toggle");
  if (theme) theme.checked = state.settings.theme === "dark";
  if (notifications) notifications.checked = state.settings.notifications;

  theme?.addEventListener("change", () => {
    state.settings.theme = theme.checked ? "dark" : "light";
    localStorage.setItem("qcu-theme", state.settings.theme);
    applyTheme();
  });
  notifications?.addEventListener("change", async () => {
    if (notifications.checked && "Notification" in window) {
      const permission = await Notification.requestPermission();
      state.settings.notifications = permission === "granted";
      notifications.checked = state.settings.notifications;
    } else {
      state.settings.notifications = false;
    }
    localStorage.setItem("qcu-notifications", String(state.settings.notifications));
  });
  document.getElementById("reset-data")?.addEventListener("click", () => {
    localStorage.removeItem("qcu-theme");
    localStorage.removeItem("qcu-notifications");
    location.reload();
  });
}

function emptyTemplate(message) {
  return `<div class="portal-card text-center text-[color:var(--muted)]">${message}</div>`;
}

function applyTheme() {
  document.body.classList.toggle("dark", state.settings.theme === "dark");
}

function updateClock() {
  const now = new Date();
  setText("live-time", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
  setText("live-day", dayNames[now.getDay()]);
  setText("live-date", now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }));
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  setText("greeting", `${greeting}, Habib`);
}

function tick() {
  updateClock();
  if (page === "home") renderHome();
  if (page === "schedule") renderSchedule();
  if (page === "today") renderToday();
}

async function init() {
  state.schedule = await loadJson("data/schedule.json", QCU_DEFAULTS.schedule);
  state.buildings = await loadJson("data/buildings.json", QCU_DEFAULTS.buildings);
  applyTheme();
  renderShell();
  tick();
  if (page === "buildings") renderBuildings();
  if (page === "settings") renderSettings();
  document.getElementById("building-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "building-modal") closeModal();
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
  iconify();
  setInterval(tick, 1000);
}

init();
