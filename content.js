(() => {
  const STORE_KEY = "allowedKeywords";
  const STORE_THEME_KEY = "currentTheme";
  const STORE_APPROVED_KEY = "approvedThemes";
  const HIDDEN_CLASS = "studytube-hidden";

  const CARD_SELECTOR = [
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-playlist-video-renderer"
  ].join(",");

  const SHORTS_SHELF_SELECTOR = [
    "ytd-reel-shelf-renderer",
    "ytd-reel-item-renderer",
    "ytd-rich-shelf-renderer",
    "ytd-shelf-renderer",
    "ytd-horizontal-card-list-renderer"
  ].join(",");

  const TITLE_SELECTOR_CANDIDATES = ["a#video-title", "#video-title"];
  const SESSION_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const MODE_BANNER_ID = "studytube-limit-banner";
  const LOCK_OVERLAY_ID = "studytube-limit-overlay";
  const TICK_INTERVAL_MS = 3000;
  const STATUS_REFRESH_INTERVAL_MS = 15000;

  let allowedKeywords = [];
  let allowedLower = [];
  let lastLoadedAt = 0;
  let scheduled = false;

  let modeStatus = { mode: "approved", remainingSec: null, lastSyncAt: 0, sessionLimitMin: 0 };
  let limitBanner = null;
  let limitBannerText = null;
  let limitControlWrapper = null;
  let limitControlSelect = null;
  let limitControlButton = null;
  let limitControlMsg = null;
  let lockOverlay = null;
  let countdownTimer = null;
  let tickTimer = null;
  let lastTickTime = Date.now();
  let modePollTimer = null;
  let watchActive = false;
  let lockEngaged = false;
  let lastModePollAt = 0;

  function ensureStyle() {
    if (document.getElementById("studytube-style")) return;
    const style = document.createElement("style");
    style.id = "studytube-style";
    style.textContent = `
      .${HIDDEN_CLASS} { display: none !important; }

      ytd-watch-next-secondary-results-renderer,
      #related {
        display: none !important;
      }

      .ytp-endscreen-content,
      .ytp-ce-element,
      .ytp-ce-covering-overlay {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function normalizeKeywords(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(x => String(x).trim()).filter(Boolean).slice(0, 50);
  }

  function isAllowed(title) {
    if (!allowedKeywords.length) return false;
    const t = String(title || "").trim();
    if (!t) return false;
    const tl = t.toLowerCase();
    for (let i = 0; i < allowedKeywords.length; i++) {
      const k = allowedKeywords[i];
      const kl = allowedLower[i];
      if (t.includes(k) || tl.includes(kl)) return true;
    }
    return false;
  }

  function getTitleFromCard(card) {
    for (const sel of TITLE_SELECTOR_CANDIDATES) {
      const el = card.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text) return text;
    }
    return "";
  }

  function purgeShortsEverywhere() {
    if (location.pathname.startsWith("/shorts")) {
      location.replace("https://www.youtube.com/");
      return;
    }

    document.querySelectorAll(SHORTS_SHELF_SELECTOR).forEach(el => el.remove());

    document.querySelectorAll('a[href^="/shorts/"], a[href*="/shorts/"]').forEach(a => {
      const card = a.closest(CARD_SELECTOR) || a.closest("ytd-reel-item-renderer") || a.closest("ytd-rich-item-renderer");
      if (card) card.remove();
    });

    document.querySelectorAll('a[href="/shorts"], a[href^="/shorts"]').forEach(a => {
      const item = a.closest("ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer");
      if (item) item.remove();
    });
  }

  function purgeWatchRecommendationsCompletely() {
    if (location.pathname !== "/watch") return;
    document.querySelectorAll("#related").forEach(el => el.remove());
    document.querySelectorAll("ytd-watch-next-secondary-results-renderer").forEach(el => el.remove());
  }

  function showSetupBannerIfNeeded() {
    let banner = document.getElementById("studytube-banner");
    if (!allowedKeywords.length) {
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "studytube-banner";
        banner.textContent = "StudyTube Filter: popupで学習テーマを設定してください（未設定のため全動画を非表示中）";
        Object.assign(banner.style, {
          position: "fixed",
          top: "12px",
          left: "12px",
          zIndex: "2147483647",
          padding: "10px 12px",
          borderRadius: "12px",
          background: "rgba(0,0,0,0.85)",
          color: "#fff",
          fontSize: "13px",
          maxWidth: "min(560px, 92vw)"
        });
        document.documentElement.appendChild(banner);
      }
    } else {
      banner?.remove();
    }
  }

  function ensureLimitBanner() {
    if (limitBanner) return limitBanner;
    const banner = document.createElement("div");
    banner.id = MODE_BANNER_ID;
    Object.assign(banner.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      padding: "10px 12px",
      borderRadius: "10px",
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      fontSize: "13px",
      zIndex: "2147483647",
      pointerEvents: "none",
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: "6px"
    });
    banner.style.display = "none";

    const text = document.createElement("div");
    limitBannerText = text;

    const controlWrap = document.createElement("div");
    controlWrap.style.display = "flex";
    controlWrap.style.alignItems = "center";
    controlWrap.style.gap = "6px";
    controlWrap.style.width = "100%";
    limitControlWrapper = controlWrap;

    const select = document.createElement("select");
    select.style.padding = "4px 6px";
    select.style.borderRadius = "6px";
    select.style.border = "1px solid rgba(255,255,255,0.4)";
    select.style.background = "transparent";
    select.style.color = "#fff";
    select.style.flex = "1";
    limitControlSelect = select;

    const options = [0, 5, 10, 15, 20, 30, 45, 60];
    options.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === 0 ? "無制限" : `${value}分`;
      select.appendChild(option);
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "セッション上限設定";
    btn.style.cursor = "pointer";
    btn.style.border = "1px solid rgba(255,255,255,0.4)";
    btn.style.borderRadius = "8px";
    btn.style.padding = "4px 8px";
    btn.style.background = "#111";
    btn.style.color = "#fff";
    btn.style.whiteSpace = "nowrap";
    btn.style.marginTop = "0";
    limitControlButton = btn;
    btn.addEventListener("click", () => {
      const minutes = Number(limitControlSelect.value);
      setSessionLimitMinutes(minutes);
    });

    controlWrap.appendChild(select);
    controlWrap.appendChild(btn);

    const note = document.createElement("div");
    note.style.fontSize = "11px";
    note.style.opacity = "0.8";
    note.style.lineHeight = "1.3";
    limitControlMsg = note;

    banner.appendChild(text);
    banner.appendChild(controlWrap);
    banner.appendChild(note);
    document.documentElement.appendChild(banner);
    limitBanner = banner;
    limitControlWrapper.style.display = "none";
    return banner;
  }

  function hideLimitBanner() {
    if (!limitBanner) return;
    limitBanner.style.display = "none";
    if (limitControlWrapper) limitControlWrapper.style.display = "none";
    if (limitControlMsg) limitControlMsg.textContent = "";
  }

  function ensureLockOverlay() {
    if (lockOverlay) return lockOverlay;
    const overlay = document.createElement("div");
    overlay.id = LOCK_OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "12px",
      background: "rgba(0,0,0,0.9)",
      color: "#fff",
      padding: "24px",
      borderRadius: "16px",
      zIndex: "2147483647",
      display: "none",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "stretch",
      gap: "12px",
      fontSize: "14px",
      pointerEvents: "auto"
    });
    overlay.style.display = "none";
    overlay.style.textAlign = "center";
    overlay.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";

    const message = document.createElement("div");
    message.id = `${LOCK_OVERLAY_ID}-message`;
    message.style.lineHeight = "1.6";

    const buttonWrap = document.createElement("div");
    buttonWrap.style.display = "flex";
    buttonWrap.style.flexDirection = "column";
    buttonWrap.style.gap = "8px";
    buttonWrap.style.width = "100%";

    const homeBtn = document.createElement("button");
    homeBtn.type = "button";
    homeBtn.textContent = "ホームへ戻る";
    homeBtn.style.background = "#111";
    homeBtn.style.border = "1px solid rgba(255,255,255,0.4)";
    homeBtn.style.padding = "10px";
    homeBtn.style.borderRadius = "10px";
    homeBtn.style.cursor = "pointer";
    homeBtn.addEventListener("click", () => {
      window.location.href = "https://www.youtube.com/";
    });

    buttonWrap.appendChild(homeBtn);
    overlay.appendChild(message);
    overlay.appendChild(buttonWrap);
    document.documentElement.appendChild(overlay);
    lockOverlay = overlay;
    return overlay;
  }

  function showLockOverlay() {
    const overlay = ensureLockOverlay();
    const message = overlay.querySelector(`#${LOCK_OVERLAY_ID}-message`);
    const remaining = getRemainingFromMode();
    const formatted = remaining === null ? "00:00" : formatDuration(remaining);
    message.innerHTML = `
      このテーマは承認済み学習テーマではないため、今日の視聴上限（残り ${formatted}）に達しました。<br>
      承認テーマに切り替えるか、明日までお待ちください。
    `;
    overlay.style.display = "flex";
  }

  function hideLockOverlay() {
    if (!lockOverlay) return;
    lockOverlay.style.display = "none";
  }

  function getRemainingFromMode() {
    if (typeof modeStatus.remainingSec !== "number") return null;
    const elapsed = (Date.now() - modeStatus.lastSyncAt) / 1000;
    return Math.max(0, Math.ceil(modeStatus.remainingSec - elapsed));
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function updateLimitBannerDisplay(customMessage) {
    if (modeStatus.mode !== "limit") {
      hideLimitBanner();
      return;
    }
    const remaining = getRemainingFromMode();
    const banner = ensureLimitBanner();
    const limitLabel = modeStatus.sessionLimitMin
      ? `セッション上限 ${modeStatus.sessionLimitMin}分`
      : "セッション上限 無制限";
    const text = remaining === null
      ? `制限モード (${limitLabel})`
      : `制限モード 残り ${formatDuration(remaining)} (${limitLabel})`;
    if (limitBannerText) limitBannerText.textContent = text;
    if (limitControlSelect) {
      limitControlSelect.value = String(modeStatus.sessionLimitMin || 0);
    }
    if (limitControlMsg) {
      limitControlMsg.textContent = customMessage || `セッション上限：${modeStatus.sessionLimitMin === 0 ? "無制限" : `${modeStatus.sessionLimitMin}分`}`;
    }
    if (limitControlWrapper) {
      limitControlWrapper.style.display = "flex";
    }
    banner.style.display = "flex";
  }

  function startCountdownTimer() {
    if (countdownTimer) return;
    countdownTimer = setInterval(() => {
      updateLimitBannerDisplay();
      const remaining = getRemainingFromMode();
      if (remaining !== null && remaining <= 0) {
        handleLimitReached();
      }
    }, 1000);
  }

  function stopCountdownTimer() {
    if (!countdownTimer) return;
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function pauseCurrentVideo() {
    const video = document.querySelector("video");
    if (video && !video.paused) {
      video.pause();
    }
  }

  async function sendTick(deltaSec) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "TICK_LIMIT",
        deltaSec,
        sessionId: SESSION_ID
      });
      if (!resp) return;
      modeStatus.mode = resp.mode || "approved";
      modeStatus.remainingSec = typeof resp.remainingSec === "number" ? resp.remainingSec : null;
      modeStatus.sessionLimitMin = typeof resp.sessionLimitMin === "number" ? resp.sessionLimitMin : modeStatus.sessionLimitMin;
      modeStatus.lastSyncAt = Date.now();
      modeStatus.sessionLimitMin = typeof resp.sessionLimitMin === "number" ? resp.sessionLimitMin : modeStatus.sessionLimitMin;
      updateLimitBannerDisplay();
      if (modeStatus.mode !== "limit") {
        stopTickLoop();
        hideLockOverlay();
        lockEngaged = false;
        return;
      }
      if (modeStatus.remainingSec !== null && modeStatus.remainingSec <= 0) {
        handleLimitReached();
      }
    } catch (error) {
      console.error("StudyTube tick error", error);
    }
  }

  async function setSessionLimitMinutes(minutes) {
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return;
    if (limitControlMsg) limitControlMsg.textContent = "設定中...";
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "SET_SESSION_QUOTA_MIN",
        minutes,
        sessionId: SESSION_ID
      });
      if (!resp) {
        if (limitControlMsg) limitControlMsg.textContent = "設定に失敗しました";
        return;
      }
      modeStatus.mode = resp.mode || "approved";
      modeStatus.remainingSec = typeof resp.remainingSec === "number" ? resp.remainingSec : null;
      modeStatus.sessionLimitMin = typeof resp.sessionLimitMin === "number" ? resp.sessionLimitMin : minutes;
      modeStatus.lastSyncAt = Date.now();
      if (limitControlSelect) {
        limitControlSelect.value = String(modeStatus.sessionLimitMin || 0);
      }
      updateLimitBannerDisplay("セッション上限を更新しました");
      if (modeStatus.mode === "limit") {
        if (!lockEngaged) startTickLoop();
        startCountdownTimer();
      } else {
        stopTickLoop();
        stopCountdownTimer();
        lockEngaged = false;
        hideLockOverlay();
      }
    } catch (error) {
      console.error("StudyTube session limit set error", error);
      if (limitControlMsg) limitControlMsg.textContent = "設定に失敗しました";
    }
  }

  function startTickLoop() {
    if (tickTimer || modeStatus.mode !== "limit") return;
    tickTimer = setInterval(() => {
      const video = document.querySelector("video");
      if (!video || video.paused || video.ended) {
        lastTickTime = Date.now();
        return;
      }
      const now = Date.now();
      const delta = Math.max(0, (now - lastTickTime) / 1000);
      lastTickTime = now;
      if (delta <= 0) return;
      sendTick(delta);
    }, TICK_INTERVAL_MS);
  }

  function stopTickLoop() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function handleLimitReached() {
    if (lockEngaged) return;
    lockEngaged = true;
    pauseCurrentVideo();
    stopTickLoop();
    stopCountdownTimer();
    showLockOverlay();
    updateLimitBannerDisplay();
  }

  async function refreshModeStatus(force = false) {
    if (!watchActive) return;
    const now = Date.now();
    if (!force && lastModePollAt && now - lastModePollAt < STATUS_REFRESH_INTERVAL_MS) return;
    lastModePollAt = now;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "GET_MODE_STATUS",
        sessionId: SESSION_ID
      });
      if (!resp) return;
      modeStatus.mode = resp.mode || "approved";
      modeStatus.remainingSec = typeof resp.remainingSec === "number" ? resp.remainingSec : null;
      modeStatus.lastSyncAt = Date.now();
      updateLimitBannerDisplay();
      if (modeStatus.mode === "limit") {
        startCountdownTimer();
        if (!lockEngaged) startTickLoop();
        const remaining = getRemainingFromMode();
        if (remaining !== null && remaining <= 0) {
          handleLimitReached();
        }
      } else {
        stopCountdownTimer();
        stopTickLoop();
        lockEngaged = false;
        hideLockOverlay();
      }
    } catch (error) {
      console.error("StudyTube mode status error", error);
    }
  }

  function handleWatchPage() {
    const isWatch = location.pathname === "/watch";
    if (isWatch && !watchActive) {
      watchActive = true;
      lockEngaged = false;
      refreshModeStatus(true);
      if (!modePollTimer) {
        modePollTimer = setInterval(() => refreshModeStatus(), STATUS_REFRESH_INTERVAL_MS);
      }
    } else if (!isWatch && watchActive) {
      watchActive = false;
      lockEngaged = false;
      stopTickLoop();
      stopCountdownTimer();
      hideLimitBanner();
      hideLockOverlay();
      if (modePollTimer) {
        clearInterval(modePollTimer);
        modePollTimer = null;
      }
    }
  }

  function filterAll() {
    ensureStyle();
    purgeShortsEverywhere();
    purgeWatchRecommendationsCompletely();
    showSetupBannerIfNeeded();

    document.querySelectorAll(CARD_SELECTOR).forEach(card => {
      if (!card.isConnected) return;
      if (card.querySelector('a[href^="/shorts/"], a[href*="/shorts/"]')) {
        card.remove();
        return;
      }
      const title = getTitleFromCard(card);
      const ok = isAllowed(title);
      if (ok) card.classList.remove(HIDDEN_CLASS);
      else card.classList.add(HIDDEN_CLASS);
    });

    handleWatchPage();
  }

  async function loadKeywords() {
    const got = await chrome.storage.sync.get({ [STORE_KEY]: [] });
    allowedKeywords = normalizeKeywords(got[STORE_KEY]);
    allowedLower = allowedKeywords.map(s => s.toLowerCase());
    lastLoadedAt = Date.now();
  }

  function scheduleFilter() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(async () => {
      scheduled = false;
      if (Date.now() - lastLoadedAt > 1500) {
        await loadKeywords().catch(() => {});
      }
      filterAll();
    }, 120);
  }

  function start() {
    loadKeywords()
      .then(() => {
        filterAll();
        const mo = new MutationObserver(() => scheduleFilter());
        mo.observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "style", "href"]
        });
        window.addEventListener("yt-navigate-finish", () => {
          scheduleFilter();
          handleWatchPage();
        }, true);
      })
      .catch(() => scheduleFilter());

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes[STORE_KEY]) {
        allowedKeywords = normalizeKeywords(changes[STORE_KEY].newValue);
        allowedLower = allowedKeywords.map(s => s.toLowerCase());
        scheduleFilter();
      }
    });
  }

  start();
})();
