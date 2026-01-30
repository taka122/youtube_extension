いまの仕組み（テーマ→OpenAIでkeywords生成→allowedKeywords保存→content.jsでフィルタ）をそのまま使いつつ、“テーマの承認状態”だけ追加で持って、watch中の時間制御を切り替える構成にします。

追加する概念：Approved Learning Themes（承認済み学習テーマ）

ユーザーはどんな文字でもテーマ入力できる（例：AI / 数学 / アニメ / ゲーム）

ただし 承認済みリストに入っているテーマだけ
→ 「その視聴は学習目的」とみなして 今まで通り（無制限）

承認済みでないテーマ（例：アニメ）
→ フィルターは効いてしまうが、それは娯楽に流れうるので 視聴時間制限を強制

重要：ここでは「学習っぽい/娯楽っぽい」を動画ごとに判定しない。
“いま選ばれているテーマが承認済みか” だけでモード切替する。
だから「アニメって入れたら娯楽動画が見れる」問題に直撃で効く。

データ設計（最小追加）
chrome.storage.sync（設定・テーマ管理）

currentTheme: string（既存）

allowedKeywords: string[]（既存）

approvedThemes: string[]（新規）

例：["AI", "数学", "統計", "英語"]

limitModeQuotaMinPerDay: number（新規 / 制限モードの1日上限、分）

例：30（30分）

（任意）limitModeQuotaMinPerSession: number（新規 / 1回上限、分）

例：25（25分）

chrome.storage.local（集計）

usageByDay: { [YYYY_MM_DD]: { limitModeSec: number } }

“未承認テーマで視聴した時間”だけを積む

こうすると「娯楽枠」「未承認学習枠」を分けたい/統合したいが後から自由にできる。

判定ルール（これだけでOK）

isApprovedTheme = approvedThemes.includes(currentTheme)

Approved（承認済み）

フィルタ：今まで通り allowedKeywords でカード表示制御

watch視聴時間：無制限

Unapproved（未承認）

フィルタ：今まで通り（※ここは“テーマ入力自由”を尊重）

watch視聴時間：制限モード（limitModeQuota を消費）

残り0で video.pause() + overlay

つまり「アニメ」というテーマでフィルタが効いても、watchは制限される。

コンポーネント責務（どこに何を足すか）
popup（設定/UI）

追加するだけでOK：

現在テーマ表示：テーマ: アニメ（未承認 → 制限モード）

ボタン/トグル：このテーマを学習テーマとして承認する

承認済み学習テーマ一覧の管理（追加/削除）

挙動

テーマ入力→適用→keywords生成→保存（既存）

その後 approvedThemes に含まれるかチェックしてUIに表示

未承認なら “制限モードになります” を明示

service worker（集計・判定API）

GET_MODE_STATUS：currentTheme と approvedThemes と usageByDay[today] から

{ mode: "approved"|"limit", remainingSec } を返す

TICK_LIMIT({deltaSec})：limitモードの時だけ usageByDay を加算して remaining 更新

content.js（視聴時間の実測）

watchページで GET_MODE_STATUS

mode === "limit" のときだけ

<video> が再生中の間、2〜5秒ごとに TICK_LIMIT(delta)

残り0なら pause + overlay

MV3はservice workerが常駐しないので、“定期的なtick”はcontent.js側に置くのが安定。

UX（ユーザーが迷わない見せ方）
1) 未承認テーマでYouTubeを見始めた瞬間（watch）

右上などに常時：制限モード 残り 12:34

0になったら overlay：

「このテーマは承認済み学習テーマではないため、今日の視聴上限に達しました」

ボタン：

ホームへ戻る

このテーマを承認する（無制限にする）（※誤爆防止で確認ダイアログ推奨）

（任意）+10分だけ延長

2) popup側での承認導線

「承認済み学習テーマ」セクション

ここに AI を追加しておけば、AI入力時は無制限

“抜け道”対策（現実的に効くやつ）

未承認テーマは 「フィルタ一致してる動画も」 制限対象にする
（＝アニメ関連が見れてしまう問題を完全に吸収）

さらに誘惑を減らすなら：

未承認テーマ中は ホーム/関連の表示をより強く削る（watch以外は極力見せない）

“検索だけ許可”にするオプションもあり（時間が余ったら）

Notionにそのまま貼れる設計メモ

（コピペ用）

Writing
Insert
追加機能：承認済み学習テーマのみ無制限、未承認テーマは視聴時間制限
目的

学習テーマ入力は自由にする（例：AI/数学/アニメ）

ただし「承認済み学習テーマ」のときだけ “学習目的の視聴” とみなして無制限

承認済みでないテーマ（例：アニメ）は、フィルタが効いても watch視聴は時間制限（制限モード）

追加データ（storage.sync）

approvedThemes: string[]（例：["AI","数学","英語"]）

limitModeQuotaMinPerDay: number（例：30=30分）

currentTheme, allowedKeywords（既存）

集計（storage.local）

usageByDay[YYYY-MM-DD].limitModeSec（未承認テーマでの視聴秒数）

判定ルール

approvedThemes に currentTheme が含まれる → approved（無制限）

含まれない → limit（制限モード、残り時間を消費）

実装責務

popup: テーマ適用後に「承認済み/未承認」を表示、未承認の場合は「承認する」導線を出す

service worker: GET_MODE_STATUS（mode/remaining）、TICK_LIMIT（limitModeSec加算）

content.js: watchでmode取得、limit時のみ video再生を監視してTICK送信。残り0で pause + overlay

UI

未承認テーマ：watch上に「制限モード 残り mm」を常時表示

0になったら overlay：ホームへ戻る / テーマを承認する /（任意）+10分延長
