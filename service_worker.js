const SYNC_KEYS = {
  currentTheme: "currentTheme",
  approvedThemes: "approvedThemes",
  allowedKeywords: "allowedKeywords",
  limitModeQuotaMinPerDay: "limitModeQuotaMinPerDay",
  limitModeQuotaMinPerSession: "limitModeQuotaMinPerSession"
};

const LOCAL_KEYS = {
  usageByDay: "usageByDay",
  sessionState: "limitModeSessionState"
};

const DEFAULTS = {
  limitModeQuotaMinPerDay: 30,
  limitModeQuotaMinPerSession: 0
};

let sessionState = { id: "", usedSec: 0 };

function normalizeList(arr) {
  if (!Array.isArray(arr)) return [];
  const normalized = [];
  const seen = new Set();
  for (const item of arr) {
    const entry = String(item || "").trim();
    if (!entry) continue;
    const lower = entry.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    normalized.push(entry);
  }
  return normalized;
}

function parseQuota(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num < 0 ? fallback : Math.floor(num);
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isApprovedTheme(theme, approvedThemes) {
  const normalized = String(theme || "").trim().toLowerCase();
  if (!normalized) return false;
  return (normalizeList(approvedThemes) || []).some(t => t.toLowerCase() === normalized);
}

async function ensureSession(sessionId) {
  const id = typeof sessionId === "string" && sessionId ? sessionId : "default";
  const stored = await chrome.storage.local.get({
    [LOCAL_KEYS.sessionState]: { id: "", usedSec: 0 }
  });
  const saved = stored[LOCAL_KEYS.sessionState] || { id: "", usedSec: 0 };
  if (saved.id !== id) {
    sessionState = { id, usedSec: 0 };
    await chrome.storage.local.set({ [LOCAL_KEYS.sessionState]: sessionState });
    return;
  }
  sessionState = { id: saved.id || id, usedSec: Number(saved.usedSec) || 0 };
}

async function getSyncSettings() {
  const settings = await chrome.storage.sync.get({
    [SYNC_KEYS.currentTheme]: "",
    [SYNC_KEYS.approvedThemes]: [],
    [SYNC_KEYS.limitModeQuotaMinPerDay]: DEFAULTS.limitModeQuotaMinPerDay,
    [SYNC_KEYS.limitModeQuotaMinPerSession]: DEFAULTS.limitModeQuotaMinPerSession
  });
  return {
    currentTheme: String(settings[SYNC_KEYS.currentTheme] || "").trim(),
    approvedThemes: normalizeList(settings[SYNC_KEYS.approvedThemes]),
    limitModeQuotaMinPerDay: parseQuota(
      settings[SYNC_KEYS.limitModeQuotaMinPerDay],
      DEFAULTS.limitModeQuotaMinPerDay
    ),
    limitModeQuotaMinPerSession: parseQuota(
      settings[SYNC_KEYS.limitModeQuotaMinPerSession],
      DEFAULTS.limitModeQuotaMinPerSession
    )
  };
}

async function getLocalUsage() {
  const data = await chrome.storage.local.get({
    [LOCAL_KEYS.usageByDay]: {}
  });
  return data[LOCAL_KEYS.usageByDay] || {};
}

async function saveLocalUsage(usageByDay) {
  await chrome.storage.local.set({
    [LOCAL_KEYS.usageByDay]: usageByDay
  });
}

function calculateRemaining(dayLimitSec, dayUsed, sessionLimitSec, sessionUsed) {
  const dayRemain = Math.max(0, dayLimitSec - (dayUsed || 0));
  if (!sessionLimitSec || sessionLimitSec <= 0) return dayRemain;
  const sessionRemain = Math.max(0, sessionLimitSec - (sessionUsed || 0));
  return Math.min(dayRemain, sessionRemain);
}

async function handleGetModeStatus(message, sendResponse) {
  await ensureSession(message?.sessionId);
  const sync = await getSyncSettings();
  const dayLimitSec = (sync.limitModeQuotaMinPerDay || DEFAULTS.limitModeQuotaMinPerDay) * 60;
  const sessionLimitSec = (sync.limitModeQuotaMinPerSession || DEFAULTS.limitModeQuotaMinPerSession) * 60;
  const usageByDay = await getLocalUsage();
  const todayKey = getTodayKey();
  const todayUsage = usageByDay[todayKey]?.limitModeSec || 0;

  if (!sync.currentTheme) {
    const remaining = calculateRemaining(
      dayLimitSec,
      todayUsage,
      sessionLimitSec,
      sessionState.usedSec
    );
    sendResponse({
      mode: "limit",
      remainingSec: remaining,
      sessionLimitMin: sync.limitModeQuotaMinPerSession
    });
    return;
  }

  const approved = isApprovedTheme(sync.currentTheme, sync.approvedThemes);
  if (approved) {
    sendResponse({
      mode: "approved",
      remainingSec: null,
      sessionLimitMin: sync.limitModeQuotaMinPerSession
    });
    return;
  }

  const remaining = calculateRemaining(
    dayLimitSec,
    todayUsage,
    sessionLimitSec,
    sessionState.usedSec
  );

  sendResponse({
    mode: "limit",
    remainingSec: remaining,
    sessionLimitMin: sync.limitModeQuotaMinPerSession
  });
}

async function handleTickLimit(message, sendResponse) {
  const deltaRequested = typeof message?.deltaSec === "number" ? message.deltaSec : Number(message?.deltaSec);
  const deltaSec = Math.max(0, Number.isFinite(deltaRequested) ? deltaRequested : 0);
  await ensureSession(message?.sessionId);
  const sync = await getSyncSettings();
  const approved = isApprovedTheme(sync.currentTheme, sync.approvedThemes);
  const dayLimitSec = (sync.limitModeQuotaMinPerDay || DEFAULTS.limitModeQuotaMinPerDay) * 60;
  const sessionLimitSec = (sync.limitModeQuotaMinPerSession || DEFAULTS.limitModeQuotaMinPerSession) * 60;
  if (!sync.currentTheme) {
    const usageByDay = await getLocalUsage();
    const todayKey = getTodayKey();
    const todayUsage = usageByDay[todayKey]?.limitModeSec || 0;
    const remaining = calculateRemaining(
      dayLimitSec,
      todayUsage,
      sessionLimitSec,
      sessionState.usedSec
    );
    sendResponse({
      mode: "limit",
      remainingSec: remaining,
      sessionLimitMin: sync.limitModeQuotaMinPerSession
    });
    return;
  }
  if (approved) {
    sendResponse({
      mode: "approved",
      remainingSec: null,
      sessionLimitMin: sync.limitModeQuotaMinPerSession
    });
    return;
  }

  const usageByDay = await getLocalUsage();
  const todayKey = getTodayKey();
  const todayEntry = usageByDay[todayKey] || { limitModeSec: 0 };
  const newDayUsed = todayEntry.limitModeSec + deltaSec;
  usageByDay[todayKey] = { limitModeSec: newDayUsed };
  await saveLocalUsage(usageByDay);

  if (sessionLimitSec > 0) {
    sessionState.usedSec = Math.min(sessionState.usedSec + deltaSec, sessionLimitSec);
    await chrome.storage.local.set({ [LOCAL_KEYS.sessionState]: sessionState });
  }

  const remaining = calculateRemaining(
    dayLimitSec,
    usageByDay[todayKey].limitModeSec,
    sessionLimitSec,
    sessionState.usedSec
  );

  sendResponse({
    mode: "limit",
    remainingSec: remaining,
    sessionLimitMin: sync.limitModeQuotaMinPerSession
  });
}

async function handleSetSessionQuota(message, sendResponse) {
  const minutesRequested = typeof message?.minutes === "number" ? message.minutes : Number(message?.minutes);
  const minutes = Math.max(0, Number.isFinite(minutesRequested) ? Math.floor(minutesRequested) : DEFAULTS.limitModeQuotaMinPerSession);
  await ensureSession(message?.sessionId);
  const stored = await chrome.storage.sync.get({
    [SYNC_KEYS.limitModeQuotaMinPerSession]: DEFAULTS.limitModeQuotaMinPerSession
  });
  if (stored[SYNC_KEYS.limitModeQuotaMinPerSession] !== minutes) {
    await chrome.storage.sync.set({ [SYNC_KEYS.limitModeQuotaMinPerSession]: minutes });
  }
  sessionState.usedSec = 0;
  await chrome.storage.local.set({ [LOCAL_KEYS.sessionState]: sessionState });

  const sync = await getSyncSettings();
  const dayLimitSec = (sync.limitModeQuotaMinPerDay || DEFAULTS.limitModeQuotaMinPerDay) * 60;
  const sessionLimitSec = (sync.limitModeQuotaMinPerSession || DEFAULTS.limitModeQuotaMinPerSession) * 60;
  const usageByDay = await getLocalUsage();
  const todayKey = getTodayKey();
  const todayUsage = usageByDay[todayKey]?.limitModeSec || 0;
  const remaining = calculateRemaining(
    dayLimitSec,
    todayUsage,
    sessionLimitSec,
    sessionState.usedSec
  );

  const approved = isApprovedTheme(sync.currentTheme, sync.approvedThemes);
  if (approved) {
    sendResponse({
      mode: "approved",
      remainingSec: null,
      sessionLimitMin: sync.limitModeQuotaMinPerSession
    });
    return;
  }

  sendResponse({
    mode: "limit",
    remainingSec: remaining,
    sessionLimitMin: sync.limitModeQuotaMinPerSession
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "GET_MODE_STATUS") {
    handleGetModeStatus(message, sendResponse);
    return true;
  }
  if (message.type === "TICK_LIMIT") {
    handleTickLimit(message, sendResponse);
    return true;
  }
  if (message.type === "SET_SESSION_QUOTA_MIN") {
    handleSetSessionQuota(message, sendResponse);
    return true;
  }
});
