(function () {
  "use strict";

  const CACHE_KEY = "qcu-google-integration-v1";
  const MIN_AUTO_SYNC_MS = 5 * 60 * 1000;
  const AUTO_REFRESH_MS = 15 * 60 * 1000;
  const localStaticPorts = new Set(["5500", "5501", "5502", "5503"]);

  const ui = {};
  let cache = loadCache();
  let account = null;
  let syncing = false;
  let autoRefreshTimer = null;

  function apiPath(path) {
    const isLocalHost = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (isLocalHost && localStaticPorts.has(location.port)) {
      return `${location.protocol}//${location.hostname}:8788${path}`;
    }
    return path;
  }

  const TYPE_META = {
    announcement: { label: "Announcement", icon: "megaphone", action: "Open Classroom" },
    material: { label: "New Material", icon: "file-text", action: "View in Classroom" },
    assignment: { label: "Assignment", icon: "clipboard-check", action: "View Assignment" },
    email: { label: "Email", icon: "mail", action: "Open Gmail" }
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadCache() {
    try {
      const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (stored && typeof stored === "object") return stored;
    } catch (_) {}
    return { email: "", preferences: null, permissions: null, updates: [], knownIds: [], checkedAt: null };
  }

  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) {}
  }

  function clearLocalCache() {
    localStorage.removeItem(CACHE_KEY);
    cache = loadCache();
  }

  function iconify() {
    if (window.lucide) window.lucide.createIcons();
  }

  function formatDate(value, includeDate = true) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Time unavailable";
    const options = includeDate
      ? { timeZone: "Asia/Manila", month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined, hour: "numeric", minute: "2-digit" }
      : { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" };
    return new Intl.DateTimeFormat([], options).format(date);
  }

  function setStatus(label, state) {
    if (!ui.status) return;
    ui.status.textContent = label;
    ui.status.className = `google-status-badge is-${state}`;
  }

  function showFeedback(message, kind = "info") {
    if (!ui.feedback) return;
    if (!message) {
      ui.feedback.hidden = true;
      ui.feedback.textContent = "";
      return;
    }
    ui.feedback.hidden = false;
    ui.feedback.className = `google-feedback is-${kind}`;
    ui.feedback.textContent = message;
  }

  async function api(path, options) {
    const endpoint = apiPath(path);
    const response = await fetch(endpoint, {
      cache: "no-store",
      credentials: endpoint.startsWith("http") ? "include" : "same-origin",
      headers: { "Content-Type": "application/json", ...(options && options.headers ? options.headers : {}) },
      ...options
    });
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const error = new Error("Google Integration server routes are unavailable.");
      error.status = response.status;
      error.code = "INVALID_API_RESPONSE";
      error.data = { status: "SERVER_UNAVAILABLE" };
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Google integration request failed.");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function permissionRow(icon, title, copy) {
    return `
      <div class="google-permission-row">
        <i data-lucide="${icon}"></i>
        <div><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>
      </div>`;
  }

  function renderNotConnected(mode) {
    const isServerUnavailable = mode === "server_unavailable";
    const isError = mode === "error" || mode === "unconfigured" || isServerUnavailable;
    const statusCopy = mode === "unconfigured"
      ? "Configuration required"
      : isServerUnavailable
        ? "Server unavailable"
        : isError ? "Connection error" : "Not connected";
    setStatus(statusCopy, isError ? "error" : "idle");
    ui.account.innerHTML = `
      <article class="google-account-card is-disconnected">
        <header class="google-card-band">
          <div class="google-band-mark"><i data-lucide="graduation-cap"></i></div>
          <div class="google-band-copy">
            <span>Google Classroom</span>
            <strong>Classroom &amp; Email Updates</strong>
          </div>
          <span class="google-card-code">QCU-GOOGLE</span>
        </header>
        <div class="google-card-body">
          <div class="google-card-lead">
            <div class="google-card-seal"><i data-lucide="book-open-check"></i></div>
            <div>
              <p class="google-card-eyebrow">Google Account</p>
              <h3>Connect Google Classroom</h3>
              <p>See Classroom announcements, materials, and assignments directly inside My-Schedule.</p>
            </div>
          </div>
          <div class="google-permissions-list" aria-label="Permissions requested">
            ${permissionRow("school", "Classroom access", "Read your courses and posted class activity.")}
            ${permissionRow("mail", "Email remains optional", "Gmail metadata is requested only when you enable it.")}
          </div>
          ${mode === "unconfigured" ? `<p class="google-inline-error">Google OAuth environment variables are not configured on this deployment.</p>` : ""}
          ${isServerUnavailable ? `<p class="google-inline-error">This preview is serving static HTML only. Start My-Schedule with Cloudflare Pages Functions before connecting Google.</p>` : ""}
          ${mode === "idle" ? `
            <a class="google-primary-button" href="${apiPath("/api/google/connect?return=settings.html%23google-integration")}">
              <i data-lucide="log-in"></i>
              Connect Google Account
            </a>` : isServerUnavailable || mode === "error" ? `
            <button class="google-primary-button" type="button" data-google-action="retry-status">
              <i data-lucide="refresh-cw"></i>
              Retry Server Check
            </button>` : `
            <span class="google-primary-button is-disabled" aria-disabled="true">
              <i data-lucide="log-in"></i>
              Connect Google Account
            </span>`}
          <p class="google-secure-note"><i data-lucide="external-link"></i>You will be redirected to Google to securely authorize access.</p>
        </div>
      </article>`;
    ui.account.setAttribute("aria-busy", "false");
    ui.updatesSection.hidden = true;
    iconify();
  }

  function toggleRow(key, title, copy, checked, disabled) {
    return `
      <label class="google-control-row">
        <span class="google-control-copy"><strong>${esc(title)}</strong><small>${esc(copy)}</small></span>
        <span class="google-switch-wrap">
          <span class="google-switch-state">${checked ? "ON" : "OFF"}</span>
          <input class="google-switch-input" type="checkbox" data-google-pref="${key}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span class="google-switch" aria-hidden="true"></span>
        </span>
      </label>`;
  }

  function renderConnected() {
    const prefs = account.preferences || { classroom: true, gmail: false, autoRefresh: true };
    const permissions = account.permissions || { gmail: false };
    setStatus("Connected", "connected");
    ui.account.innerHTML = `
      <article class="google-account-card is-connected">
        <header class="google-card-band">
          <div class="google-band-mark"><i data-lucide="graduation-cap"></i></div>
          <div class="google-band-copy">
            <span>Google Classroom</span>
            <strong>Authorized Account</strong>
          </div>
          <span class="google-card-code">CONNECTED</span>
        </header>
        <div class="google-card-body">
          <div class="google-account-identity">
            <div class="google-card-seal is-connected"><i data-lucide="check"></i></div>
            <div>
              <p class="google-card-eyebrow">Google Account</p>
              <h3>${esc(account.email || "Google account")}</h3>
              <p>Authorization is active. Tokens remain encrypted and unavailable to frontend JavaScript.</p>
            </div>
          </div>
          <div class="google-controls">
            ${toggleRow("classroom", "Classroom Updates", "Announcements, materials, and assignments", prefs.classroom !== false, false)}
            ${toggleRow("gmail", "Gmail Notifications", permissions.gmail ? "Relevant message metadata only" : "Requires separate Google authorization", prefs.gmail === true, false)}
            ${toggleRow("autoRefresh", "Auto Refresh", "Checks at most every 15 minutes while active", prefs.autoRefresh !== false, false)}
          </div>
          <div class="google-sync-row">
            <div>
              <span>Last synchronized</span>
              <strong>${cache.checkedAt ? esc(formatDate(cache.checkedAt)) : "Not synchronized yet"}</strong>
            </div>
            <button class="google-icon-button" type="button" data-google-action="refresh" title="Refresh Google updates" aria-label="Refresh Google updates" ${syncing ? "disabled" : ""}>
              <i data-lucide="refresh-cw"${syncing ? " class=\"is-spinning\"" : ""}></i>
            </button>
          </div>
          ${account.needsReauthorization ? `
            <div class="google-renewal">
              <div><strong>Authorization renewal required</strong><span>Your Google connection has expired or was revoked.</span></div>
              <a class="google-primary-button" href="${apiPath(`/api/google/connect?${permissions.gmail ? "gmail=1&" : ""}return=settings.html%23google-integration`)}"><i data-lucide="key-round"></i>Reconnect Google</a>
            </div>` : ""}
          <div class="google-account-actions">
            <button class="google-secondary-button" type="button" data-google-action="refresh" ${syncing ? "disabled" : ""}><i data-lucide="refresh-cw"></i>${syncing ? "Refreshing" : "Refresh Now"}</button>
            <button class="google-danger-button" type="button" data-google-action="disconnect"><i data-lucide="unlink"></i>Disconnect Google Account</button>
          </div>
        </div>
      </article>`;
    ui.account.setAttribute("aria-busy", String(syncing));
    ui.updatesSection.hidden = false;
    renderUpdates();
    iconify();
  }

  function updateCard(item) {
    const meta = TYPE_META[item.type] || TYPE_META.announcement;
    const due = item.dueAt ? `<span><i data-lucide="calendar-clock"></i>Due ${esc(formatDate(item.dueAt))}</span>` : "";
    const detail = item.materialType ? `<span><i data-lucide="paperclip"></i>${esc(item.materialType)}</span>` : "";
    const author = item.author ? `<p class="google-update-author">From ${esc(item.author)}</p>` : "";
    return `
      <article class="google-update-card type-${esc(item.type)}${item.isNew ? " is-new" : ""}" data-update-id="${esc(item.id)}">
        <header class="google-update-band">
          <div class="google-update-label"><i data-lucide="${meta.icon}"></i><span>${esc(meta.label)}</span></div>
          ${item.isNew ? `<span class="google-new-badge">New</span>` : `<span class="google-source-code">${item.source === "gmail" ? "GMAIL" : "CLASSROOM"}</span>`}
        </header>
        <div class="google-update-body">
          <p class="google-update-course">${esc(item.courseName || "Google Classroom")}</p>
          <h3>${esc(item.title || "Classroom update")}</h3>
          ${item.description && item.description !== item.title ? `<p class="google-update-description">${esc(item.description)}</p>` : ""}
          ${author}
          <div class="google-update-meta">
            <span><i data-lucide="clock-3"></i>${esc(formatDate(item.postedAt || item.createdAt))}</span>
            ${detail}
            ${due}
          </div>
          <a class="google-update-action" href="${esc(item.url || "https://classroom.google.com")}" target="_blank" rel="noopener noreferrer" data-google-open-update="${esc(item.id)}">
            ${esc(meta.action)}<i data-lucide="external-link"></i>
          </a>
        </div>
      </article>`;
  }

  function renderUpdates() {
    if (!ui.updatesList || !account || !account.connected) return;
    const updates = Array.isArray(cache.updates) ? cache.updates : [];
    const newCount = updates.filter(item => item.isNew).length;
    ui.count.textContent = `${updates.length} update${updates.length === 1 ? "" : "s"}${newCount ? `, ${newCount} new` : ""}`;
    ui.offline.hidden = navigator.onLine;

    if (syncing && !updates.length) {
      ui.updatesList.innerHTML = `
        <div class="google-updates-loading" aria-label="Loading Classroom updates">
          <span class="skeleton-line skeleton-line-lg"></span>
          <span class="skeleton-line"></span>
          <span class="skeleton-line skeleton-line-sm"></span>
        </div>`;
    } else if (!updates.length) {
      ui.updatesList.innerHTML = `
        <div class="google-empty-state">
          <i data-lucide="inbox"></i>
          <h3>No new Classroom updates</h3>
          <p>You're all caught up. New announcements, materials, and assignments will appear here.</p>
          <span>Last checked: ${cache.checkedAt ? esc(formatDate(cache.checkedAt)) : "Not yet checked"}</span>
          <button class="google-secondary-button" type="button" data-google-action="refresh" ${syncing || !navigator.onLine ? "disabled" : ""}><i data-lucide="refresh-cw"></i>Refresh</button>
        </div>`;
    } else {
      ui.updatesList.innerHTML = updates.map(updateCard).join("");
    }
    iconify();
  }

  function mergeUpdates(incoming) {
    const previous = new Map((cache.updates || []).map(item => [item.id, item]));
    const known = new Set(cache.knownIds || []);
    const hadPreviousSync = Boolean(cache.checkedAt);
    const newlyDetected = [];
    const merged = (incoming || []).map(item => {
      const old = previous.get(item.id);
      const isNew = old ? old.isNew === true : hadPreviousSync && !known.has(item.id);
      if (isNew && !old) newlyDetected.push(item);
      return { ...item, isNew };
    });
    cache.updates = merged;
    cache.knownIds = Array.from(new Set([...known, ...merged.map(item => item.id)])).slice(-250);
    return newlyDetected;
  }

  function notifyNewUpdates(items) {
    if (!items.length || !("Notification" in window) || Notification.permission !== "granted") return;
    const first = items[0];
    const body = items.length === 1 ? first.title : `${items.length} new Classroom updates are available.`;
    try { new Notification(first.courseName || "Google Classroom", { body, icon: "assets/images/QCU college of computer studies logo.jpg" }); } catch (_) {}
  }

  async function syncUpdates(force) {
    if (!account || !account.connected || syncing) return;
    if (!navigator.onLine) {
      showFeedback("Offline - showing last synced updates.", "info");
      renderUpdates();
      return;
    }
    const elapsed = Date.now() - new Date(cache.checkedAt || 0).getTime();
    if (!force && cache.checkedAt && elapsed < MIN_AUTO_SYNC_MS) return;
    syncing = true;
    showFeedback("", "info");
    renderConnected();
    try {
      const result = await api("/api/google/updates");
      const preserveCachedFeed = result.status === "PARTIAL" && !(result.updates || []).length;
      const newlyDetected = preserveCachedFeed ? [] : mergeUpdates(result.updates || []);
      cache.checkedAt = result.checkedAt || new Date().toISOString();
      saveCache();
      if (result.warnings && result.warnings.length) showFeedback(result.warnings.join(" "), "warning");
      notifyNewUpdates(newlyDetected);
    } catch (error) {
      if (error.data && error.data.status === "REAUTHORIZE") {
        account.needsReauthorization = true;
        showFeedback("Your Google connection needs to be renewed.", "error");
        setStatus("Connection error", "error");
      } else {
        showFeedback(error.message || "Google Classroom couldn't be reached right now.", "error");
      }
    } finally {
      syncing = false;
      renderConnected();
    }
  }

  async function savePreference(input) {
    const key = input.dataset.googlePref;
    const previous = { ...(account.preferences || {}) };
    const next = { ...previous, [key]: input.checked };
    if (key === "gmail" && input.checked && !(account.permissions && account.permissions.gmail)) {
      window.location.href = apiPath("/api/google/connect?gmail=1&return=settings.html%23google-integration");
      return;
    }
    account.preferences = next;
    cache.preferences = next;
    renderConnected();
    try {
      const result = await api("/api/google/preferences", { method: "POST", body: JSON.stringify(next) });
      account.preferences = result.preferences;
      cache.preferences = result.preferences;
      saveCache();
      configureAutoRefresh();
      if (key === "classroom" && input.checked) syncUpdates(true);
    } catch (error) {
      account.preferences = previous;
      cache.preferences = previous;
      saveCache();
      showFeedback(error.message, "error");
      renderConnected();
    }
  }

  async function disconnect() {
    if (!navigator.onLine) {
      showFeedback("Connect to the internet before disconnecting your Google account.", "warning");
      return;
    }
    if (!window.confirm("Disconnect this Google account from My-Schedule? Cached Classroom updates on this device will also be removed.")) return;
    try { await api("/api/google/disconnect", { method: "POST", body: "{}" }); }
    catch (_) {}
    clearLocalCache();
    account = { connected: false, status: "not_connected" };
    showFeedback("Google account disconnected.", "info");
    renderNotConnected("idle");
  }

  function markRead(id) {
    const item = (cache.updates || []).find(update => update.id === id);
    if (!item || !item.isNew) return;
    item.isNew = false;
    saveCache();
    renderUpdates();
  }

  function configureAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    if (!account || !account.connected || !account.preferences || account.preferences.autoRefresh === false) return;
    autoRefreshTimer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) syncUpdates(false);
    }, AUTO_REFRESH_MS);
  }

  function handleOAuthResult() {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    if (!result) return;
    const messages = {
      connected: ["Google account connected.", "success"],
      cancelled: ["Google connection was cancelled.", "warning"],
      gmail_denied: ["Gmail notifications are disabled. You can enable them later from Google Integration settings.", "warning"],
      failed: ["We couldn't connect your Google account. Please try again.", "error"],
      unconfigured: ["Google OAuth is not configured on this deployment.", "error"]
    };
    if (messages[result]) {
      const reason = result === "failed" ? url.searchParams.get("reason") : "";
      showFeedback(reason ? `${messages[result][0]} (${reason})` : messages[result][0], messages[result][1]);
    }
    url.searchParams.delete("google");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function loadStatus() {
    if (location.hostname.endsWith("github.io")) {
      renderNotConnected("server_unavailable");
      showFeedback("This GitHub Pages preview is static and cannot run Google OAuth. Open the deployed Cloudflare Pages URL instead.", "error");
      return;
    }
    if (!navigator.onLine) {
      if (cache.email) {
        account = { connected: true, email: cache.email, preferences: cache.preferences, permissions: cache.permissions };
        setStatus("Connected", "connected");
        renderConnected();
        showFeedback("Offline - showing last synced updates.", "info");
      } else {
        renderNotConnected("idle");
        showFeedback("You're offline. Connect to the internet to authorize Google.", "info");
      }
      return;
    }
    try {
      account = await api("/api/google/status");
      if (!account.connected) {
        renderNotConnected(account.status === "unconfigured" ? "unconfigured" : "idle");
        return;
      }
      cache.email = account.email;
      cache.preferences = account.preferences;
      cache.permissions = account.permissions;
      saveCache();
      renderConnected();
      configureAutoRefresh();
      syncUpdates(false);
    } catch (error) {
      if (error.code === "INVALID_API_RESPONSE") {
        renderNotConnected("server_unavailable");
        showFeedback("Google Integration requires Cloudflare Pages Functions. A static HTML server cannot run OAuth.", "error");
      } else if (error.status === 503) renderNotConnected("unconfigured");
      else {
        renderNotConnected("error");
        showFeedback("We couldn't check your Google connection. Please try again.", "error");
      }
    }
  }

  function bindEvents() {
    document.getElementById("google-integration").addEventListener("click", event => {
      const action = event.target.closest("[data-google-action]");
      if (action && action.dataset.googleAction === "refresh") syncUpdates(true);
      if (action && action.dataset.googleAction === "disconnect") disconnect();
      if (action && action.dataset.googleAction === "retry-status") loadStatus();
      const update = event.target.closest("[data-google-open-update]");
      if (update) markRead(update.dataset.googleOpenUpdate);
    });
    document.getElementById("google-integration").addEventListener("change", event => {
      const input = event.target.closest("[data-google-pref]");
      if (input) savePreference(input);
    });
    window.addEventListener("online", () => { showFeedback("", "info"); loadStatus(); });
    window.addEventListener("offline", () => { showFeedback("Offline - showing last synced updates.", "info"); renderUpdates(); });
  }

  function init() {
    ui.account = document.getElementById("google-account-card");
    if (!ui.account) return;
    ui.status = document.getElementById("google-status-indicator");
    ui.feedback = document.getElementById("google-feedback");
    ui.updatesSection = document.getElementById("google-updates-section");
    ui.updatesList = document.getElementById("google-updates-list");
    ui.count = document.getElementById("google-update-count");
    ui.offline = document.getElementById("google-offline-notice");
    bindEvents();
    handleOAuthResult();
    loadStatus();
  }

  window.QCUGoogleIntegration = { init, clearLocalCache };
})();
