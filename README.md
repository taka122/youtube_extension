# StudyTube Filter (Atlas / Chromium Extension)

YouTubeを「学習テーマに関連するタイトルだけ表示される環境」にする拡張機能です。  
指定テーマ → OpenAI APIでキーワード生成 → `allowedKeywords` を保存 → YouTube DOMを後処理でフィルタします。

## できること
- popupで学習テーマを入力し「適用」
- 「承認済み学習テーマ」一覧を管理し、承認済みなら無制限、未承認なら制限モードへ
- OpenAI APIで関連キーワード（10個以内）を生成し、`chrome.storage.sync` の `allowedKeywords` に保存
- YouTube（ホーム / 検索結果 / 関連動画 / チャンネル等）の動画カードを監視し、
  タイトルが `allowedKeywords` のどれかに **部分一致** したものだけ表示
- SPA（無限スクロール / ページ遷移）でも継続（MutationObserver + yt-navigate-finish）
- watchページでは未承認テーマ時に制限モードとして残り時間がバナー・オーバーレイで表示され、0秒で再生stop

## 承認済み学習テーマと制限モード

- 承認済みリスト（`approvedThemes`）に入っているテーマだけを「学習目的」とみなし、watchページ視聴は無制限。
- 未承認テーマは「制限モード」に入り、`limitModeQuotaMinPerDay`（例：30分）と任意の `limitModeQuotaMinPerSession`（例：25分）を消費。
- 制限モード中は右上に「制限モード 残り mm:ss」バナーを表示し、残り0になると overlay で再生を停止して選び直し（ホームへ/テーマ承認）を促します。
- 制限モードでもテーマ入力とキーワード生成は動くので、承認済みに追加すれば即解除されます。

## データ設計と集計

- `chrome.storage.sync`
  - `currentTheme`：現在のテーマ
  - `allowedKeywords`：OpenAI生成＋手動キーワード
  - `approvedThemes`：承認済み学習テーマ
- `limitModeQuotaMinPerDay`：制限モードの日次上限（分、デフォルト 30）
- `limitModeQuotaMinPerSession`：1セッション上限（分、0=無制限）
- `chrome.storage.local`
  - `usageByDay`：`{ YYYY-MM-DD: { limitModeSec: number } }` で 1 日の未承認テーマ視聴秒数
  - `limitModeSessionState`：現在セッションの使用秒数と ID（`sessionId`, `usedSec`）でセッション制限を制御

## 内部動作メモ（サービスワーカー）

- `GET_MODE_STATUS`：`currentTheme`, `approvedThemes`, `usageByDay` から { mode: "approved"|"limit", remainingSec } を返す
- `TICK_LIMIT`：未承認モードの再生中に `deltaSec` を渡すと使用秒数を加算し、残りを返す
- `content.js` は watch ページで `GET_MODE_STATUS` を定期取得し、残りをバナー表示。制限中は `TICK_LIMIT` を数秒ごとに呼んで残秒を消費し、0秒で `video.pause()`＋オーバーレイを表示。

## YouTube画面でセッション制限を調整

- 制限モードでは右上バナーの中に「セッション上限（分）」のセレクトと「セット」ボタンが表示され、YouTube画面から直接そのセッションだけの制限時間（0=無制限含む）を選べます。
- 設定するとサービスワーカーが `limitModeQuotaMinPerSession` を更新・そのセッションの使用秒数をリセットし直ちに残時間を表示。

## セットアップ
1. `chrome://extensions` を開く
2. デベロッパーモード ON
3. 「パッケージ化されていない拡張機能を読み込む」→ この `studytube-filter/` を選択
4. ツールバーの拡張機能アイコンから popup を開き、OpenAI API Key と 学習テーマを入力して「適用」

## セキュリティ注意（重要）
- **APIキーを拡張機能（ブラウザ側）に置くのは漏洩リスクがあります。**
- 本拡張は個人利用・ローカル運用前提です。公開配布は想定しません。
- 公開するなら、必ずサーバー/プロキシ経由（キーはサーバー側で保持）にしてください。

## Acceptance Criteria（例）
- YouTubeホームでテーマを「生成AI」に設定
- 関係ない動画が非表示になり、生成AI関連タイトルだけが表示され続ける（遷移・スクロール後も継続）
