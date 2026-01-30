const $ = (id) => document.getElementById(id);

const MAX_KEYWORDS = 50;
const DEFAULT_DAILY_QUOTA = 30;
const DEFAULT_SESSION_QUOTA = 0;

const STORE_KEYS = {
  apiKey: "openaiApiKey",
  theme: "currentTheme",
  allowed: "allowedKeywords",
  approved: "approvedThemes",
  limitDaily: "limitModeQuotaMinPerDay",
  limitSession: "limitModeQuotaMinPerSession"
};

let approvedThemesCache = [];
let currentTheme = "";

function setStatus(text, kind = "default") {
  const el = $("status");
  el.className = "status-message";
  if (kind === "ok") el.classList.add("ok");
  else if (kind === "ng") el.classList.add("ng");
  el.textContent = text;
}

function normalizeKeywordList(list = [], limit = MAX_KEYWORDS) {
  const seen = new Set();
  const normalized = [];
  if (!Array.isArray(list)) return normalized;
  for (const item of list) {
    const value = String(item || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function formatQuotaNumber(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

const keywordsToggle = $("toggleKeywords");
const keywordsPre = $("keywords");
let keywordsVisible = false;

function displayKeywords(list) {
  keywordsPre.textContent = Array.isArray(list) && list.length ? JSON.stringify(list, null, 2) : "(未設定)";
}

function setKeywordsVisibility(show) {
  keywordsVisible = Boolean(show);
  keywordsPre.classList.toggle("visible", keywordsVisible);
  if (keywordsToggle) {
    keywordsToggle.textContent = keywordsVisible ? "非表示" : "表示";
  }
}

function updateThemeStatus(theme, approvedThemes) {
  const status = $("themeStatus");
  currentTheme = String(theme || "").trim();
  if (!currentTheme) {
    status.textContent = "テーマを入力して「適用」してください。";
    return;
  }
  const approved = (approvedThemes || []).some(t => t.toLowerCase() === currentTheme.toLowerCase());
  status.textContent = `テーマ: ${currentTheme}（${approved ? "承認済み" : "未承認：制限モード"}）`;
}

function renderApprovedList(themes) {
  approvedThemesCache = normalizeKeywordList(themes);
  const list = $("approvedList");
  list.innerHTML = "";
  if (!approvedThemesCache.length) {
    const placeholder = document.createElement("li");
    placeholder.textContent = "(未登録)";
    list.appendChild(placeholder);
    return;
  }
  for (const theme of approvedThemesCache) {
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.marginBottom = "4px";

    const label = document.createElement("span");
    label.textContent = theme;
    label.style.fontSize = "12px";
    label.style.lineHeight = "1.2";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "small";
    btn.textContent = "削除";
    btn.dataset.theme = theme;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      removeApprovedTheme(theme);
    });

    li.appendChild(label);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function removeApprovedTheme(theme) {
  if (!theme) return;
  const confirmed = window.confirm(`「${theme}」を承認済みテーマから削除しますか？`);
  if (!confirmed) return;
  const stored = await chrome.storage.sync.get({
    [STORE_KEYS.approved]: []
  });
  const filtered = normalizeKeywordList(
    (stored[STORE_KEYS.approved] || []).filter(t => t.toLowerCase() !== theme.toLowerCase())
  );
  await chrome.storage.sync.set({ [STORE_KEYS.approved]: filtered });
  renderApprovedList(filtered);
  updateThemeStatus($("theme").value, filtered);
  setStatus(`✅ 「${theme}」をリストから削除しました`, "ok");
}

async function addApprovedTheme(theme) {
  const value = String((theme || $("approvedInput").value) || "").trim();
  if (!value) return setStatus("承認したいテーマ名を入力してください", "ng");
  const stored = await chrome.storage.sync.get({
    [STORE_KEYS.approved]: []
  });
  const combined = normalizeKeywordList([
    ...(stored[STORE_KEYS.approved] || []),
    value
  ]);
  await chrome.storage.sync.set({ [STORE_KEYS.approved]: combined });
  renderApprovedList(combined);
  $("approvedInput").value = "";
  updateThemeStatus($("theme").value, combined);
  setStatus(`✅ 「${value}」を承認済みテーマに追加しました`, "ok");
}

async function saveQuotaSettings() {
  const daily = formatQuotaNumber($("dailyQuota").value.trim(), DEFAULT_DAILY_QUOTA);
  const session = formatQuotaNumber($("sessionQuota").value.trim(), DEFAULT_SESSION_QUOTA);
  await chrome.storage.sync.set({
    [STORE_KEYS.limitDaily]: daily,
    [STORE_KEYS.limitSession]: session
  });
  setStatus("✅ 制限モードの設定を保存しました", "ok");
}

function extractOutputText(respJson) {
  if (typeof respJson?.output_text === "string" && respJson.output_text.trim()) {
    return respJson.output_text.trim();
  }
  const out = respJson?.output;
  if (!Array.isArray(out)) return "";
  let buf = "";
  for (const item of out) {
    if (item?.type !== "message") continue;
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "output_text" && typeof c.text === "string") buf += c.text;
    }
  }
  return buf.trim();
}

async function callOpenAIKeywords({ apiKey, theme }) {
  const prompt =
`次のテーマに関連するYouTube動画タイトル判定用キーワードを、日本語・英語混在で10個以内で列挙してください。
余計な説明は不要で、配列形式のみを返してください。
テーマ：${theme}`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      keywords: {
        type: "array",
        items: { type: "string" },
        maxItems: 10
      }
    },
    required: ["keywords"]
  };

  const body = {
    model: "gpt-4o-mini",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "allowed_keywords",
        schema,
        strict: true
      }
    }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `OpenAI error: ${resp.status}`);
  const text = extractOutputText(data);
  if (!text) throw new Error("Empty response text");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Failed to parse JSON object");
    parsed = JSON.parse(m[0]);
  }

  const arr = parsed?.keywords;
  if (!Array.isArray(arr)) throw new Error("Response.keywords is not an array");

  return normalizeKeywordList(arr);
}

async function load() {
  const settings = await chrome.storage.sync.get({
    [STORE_KEYS.apiKey]: "",
    [STORE_KEYS.theme]: "",
    [STORE_KEYS.allowed]: [],
    [STORE_KEYS.approved]: [],
    [STORE_KEYS.limitDaily]: DEFAULT_DAILY_QUOTA,
    [STORE_KEYS.limitSession]: DEFAULT_SESSION_QUOTA
  });
  $("apiKey").value = settings[STORE_KEYS.apiKey] || "";
  $("theme").value = settings[STORE_KEYS.theme] || "";
  currentTheme = $("theme").value.trim();
  displayKeywords(settings[STORE_KEYS.allowed]);
  renderApprovedList(settings[STORE_KEYS.approved]);
  updateThemeStatus(currentTheme, settings[STORE_KEYS.approved]);
  if (settings[STORE_KEYS.limitDaily] !== undefined && settings[STORE_KEYS.limitDaily] !== null) {
    $("dailyQuota").value = settings[STORE_KEYS.limitDaily];
  } else {
    $("dailyQuota").value = "";
  }
  if (settings[STORE_KEYS.limitSession] !== undefined && settings[STORE_KEYS.limitSession] !== null) {
    $("sessionQuota").value = settings[STORE_KEYS.limitSession];
  } else {
    $("sessionQuota").value = "";
  }
}

async function apply() {
  setStatus("処理中...");
  const apiKey = $("apiKey").value.trim();
  const theme = $("theme").value.trim();
  if (!apiKey) return setStatus("API Keyを入力してください（個人利用前提）", "ng");
  if (!theme) return setStatus("学習テーマを入力してください", "ng");
  try {
    await chrome.storage.sync.set({
      [STORE_KEYS.apiKey]: apiKey,
      [STORE_KEYS.theme]: theme
    });
    const keywords = await callOpenAIKeywords({ apiKey, theme });
    await chrome.storage.sync.set({
      [STORE_KEYS.allowed]: keywords
    });
    displayKeywords(keywords);
    const approved = await chrome.storage.sync.get({ [STORE_KEYS.approved]: [] });
    renderApprovedList(approved[STORE_KEYS.approved]);
    updateThemeStatus(theme, approved[STORE_KEYS.approved]);
    setStatus(`✅ 適用しました（${keywords.length} keywords）`, "ok");
  } catch (e) {
    setStatus(`❌ 失敗: ${String(e)}`, "ng");
  }
}

$("apply").addEventListener("click", apply);
$("addApproved").addEventListener("click", () => addApprovedTheme());
$("saveQuota").addEventListener("click", saveQuotaSettings);
$("theme").addEventListener("input", () => updateThemeStatus($("theme").value, approvedThemesCache));
$("approvedInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addApprovedTheme();
  }
});
$("approvedList").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-theme]");
  if (!btn) return;
  const theme = btn.dataset.theme;
  if (theme) removeApprovedTheme(theme);
});
if (keywordsToggle) {
  keywordsToggle.addEventListener("click", () => setKeywordsVisibility(!keywordsVisible));
}
setStatus("", "default");
setKeywordsVisibility(false);
load();
