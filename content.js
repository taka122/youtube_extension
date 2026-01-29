(() => {
  const STORE_KEY = "allowedKeywords";
  const HIDDEN_CLASS = "studytube-hidden";

  // ホーム/検索などの動画カード（watchの関連は廃止するので判定対象から外してもOK）
  const CARD_SELECTOR = [
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-playlist-video-renderer"
  ].join(",");

  // Shorts棚や横スクロール棚など（Shorts含むものは問答無用で削除）
  const SHORTS_SHELF_SELECTOR = [
    "ytd-reel-shelf-renderer",
    "ytd-reel-item-renderer",
    "ytd-rich-shelf-renderer",
    "ytd-shelf-renderer",
    "ytd-horizontal-card-list-renderer"
  ].join(",");

  const TITLE_SELECTOR_CANDIDATES = ["a#video-title", "#video-title"];

  let allowedKeywords = [];
  let allowedLower = [];
  let lastLoadedAt = 0;
  let scheduled = false;

  function ensureStyle() {
    if (document.getElementById("studytube-style")) return;
    const style = document.createElement("style");
    style.id = "studytube-style";
    style.textContent = `
      .${HIDDEN_CLASS} { display: none !important; }

      /* ✅ watchページの「おすすめ（関連動画）」は完全廃止 */
      ytd-watch-next-secondary-results-renderer,
      #related {
        display: none !important;
      }

      /* ✅ 動画再生終了時のエンドスクリーン/カード（おすすめ誘導）も廃止 */
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
    if (!allowedKeywords.length) return false; // fail-closed：未設定なら全部ブロック
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

  // ✅ Shortsは問答無用で削除
  function purgeShortsEverywhere() {
    if (location.pathname.startsWith("/shorts")) {
      location.replace("https://www.youtube.com/");
      return;
    }

    document.querySelectorAll(SHORTS_SHELF_SELECTOR).forEach(el => el.remove());

    // /shorts/ リンクを含むカードは削除
    document.querySelectorAll('a[href^="/shorts/"], a[href*="/shorts/"]').forEach(a => {
      const card = a.closest(CARD_SELECTOR) || a.closest("ytd-reel-item-renderer") || a.closest("ytd-rich-item-renderer");
      if (card) card.remove();
    });

    // サイドバーのShorts導線も消す
    document.querySelectorAll('a[href="/shorts"], a[href^="/shorts"]').forEach(a => {
      const item = a.closest("ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer");
      if (item) item.remove();
    });
  }

  // ✅ watchページの「下/右側おすすめ（関連動画）」を完全廃止（DOMからも消す）
  function purgeWatchRecommendationsCompletely() {
    if (location.pathname !== "/watch") return;

    // 関連動画の親（多くのレイアウトでここ）
    document.querySelectorAll("#related").forEach(el => el.remove());

    // 右カラムの関連コンテナ（YouTubeが差し替えてくるので都度remove）
    document.querySelectorAll("ytd-watch-next-secondary-results-renderer").forEach(el => {
      // Live chatなど別要素を巻き込みたくないので、このrenderer自体を消す
      el.remove();
    });
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

  function filterAll() {
    ensureStyle();

    purgeShortsEverywhere();

    // ✅ watchはおすすめを完全廃止（キーワード判定は不要）
    purgeWatchRecommendationsCompletely();

    showSetupBannerIfNeeded();

    // ホーム/検索などの動画カードはキーワードで制御
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

        window.addEventListener("yt-navigate-finish", scheduleFilter, true);
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
