const $ = (id) => document.getElementById(id);

const STORE_KEYS = {
  apiKey: "openaiApiKey",
  theme: "currentTheme",
  allowed: "allowedKeywords"
};

function setStatus(text, kind = "muted") {
  const el = $("status");
  el.className = "muted " + (kind === "ok" ? "ok" : kind === "ng" ? "ng" : "");
  el.textContent = text;
}

function extractOutputText(respJson) {
  // Responses API は環境で返し方が少し違うことがあるので複数パターン対応
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

  // ✅ ルートが object 必須なので { keywords: string[] } で返させる
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

  // 正規化（trim/重複排除/最大10）
  const uniq = [];
  const seen = new Set();
  for (const x of arr) {
    const s = String(x).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
    if (uniq.length >= 10) break;
  }
  return uniq;
}

async function load() {
  const got = await chrome.storage.sync.get({
    [STORE_KEYS.apiKey]: "",
    [STORE_KEYS.theme]: "",
    [STORE_KEYS.allowed]: []
  });
  $("apiKey").value = got[STORE_KEYS.apiKey] || "";
  $("theme").value = got[STORE_KEYS.theme] || "";
  const kw = got[STORE_KEYS.allowed];
  $("keywords").textContent = Array.isArray(kw) && kw.length ? JSON.stringify(kw, null, 2) : "(未設定)";
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

    $("keywords").textContent = JSON.stringify(keywords, null, 2);
    setStatus(`✅ 適用しました（${keywords.length} keywords）`, "ok");
  } catch (e) {
    setStatus(`❌ 失敗: ${String(e)}`, "ng");
  }
}

$("apply").addEventListener("click", apply);
load();
