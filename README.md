# StudyTube Filter (Atlas / Chromium Extension)

YouTubeを「学習テーマに関連するタイトルだけ表示される環境」にする拡張機能です。  
指定テーマ → OpenAI APIでキーワード生成 → `allowedKeywords` を保存 → YouTube DOMを後処理でフィルタします。

## できること
- popupで学習テーマを入力し「適用」
- OpenAI APIで関連キーワード（10個以内）を生成し、`chrome.storage.sync` の `allowedKeywords` に保存
- YouTube（ホーム / 検索結果 / 関連動画 / チャンネル等）の動画カードを監視し、
  タイトルが `allowedKeywords` のどれかに **部分一致** したものだけ表示
- SPA（無限スクロール / ページ遷移）でも継続（MutationObserver + yt-navigate-finish）

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
