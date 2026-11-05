# チェックメイゴ CHECKMEIGO

チェスと囲碁（9路）を同じ画面で遊べる静的 Web アプリです。同一端末での2人対戦、AIなし。
将来「チェスの升目の交点に碁石を置く」混合ルールを足すための土台として、チェスと囲碁を**完全に分離**した状態で実装しています。

**公開URL:** https://sas-news.github.io/checkmeigo/

## いま出来ること

### ♞ チェス
- 駒の動き・取り方・合法手ハイライト（移動=緑、取り=赤）
- チェック／チェックメイト／ステイルメイト
- キャスリング（キング側・クイーン側、通過マスの被利き判定込み）
- アンパッサン、プロモーション（♕♖♗♘から選択）
- 50手ルール、駒不足ドロー
- 1手戻る、盤面反転、投了（2タップ確認）、棋譜表示
- 取った駒の表示、直前の手のハイライト

### ● 囲碁（9路）
- 交点タップで着手（スマホは同じ点を2タップで確定）
- 呼吸点が無くなった連の取り上げ、自殺手禁止、コウ（同一局面の再現）禁止
- 連続パスで終局確認 → 死に石を自動判定（2眼あり／呼吸点3以上は生き扱いの保守判定）→ タップで修正 → **中国ルール式（地＋盤上の石、コミなし）**で集計
- 1手戻る、投了、棋譜表示、石数表示

### ＋ 混合（準備中）
チェス盤の升目の交点（9×9）に碁石を置く構想。石が駒の動きに与える影響などの**ルールが未定**のため、タブだけ用意して実装は保留しています。

## デザインシステムの流用元

GUI の基礎は [cerevisiae-fii/hexago](https://github.com/sas-news/hexago) から**デザインシステムだけ**を流用しています。

- 流用したもの: Tailwind CSS 土台、CSS 変数テーマ（`--bg` / `--tx` / `--card` / `--bd`）、`.card` / `.btn` / `.opt` / `.dot`、ヘッダ＋設定・ルールボタン、手番カード、canvas＋操作ボタン列、終局確認バナー、結果バナー、undo・設定・ルール・結果モーダル、テーマ切替、効果音、sessionStorage 保存
- 削除したもの: PeerJS オンライン対戦一式、六角盤ジオメトリ、MCTS エンジン、2〜6人の可変人数、AI 席切替、ベンチ・E2E・WASM
- 差し替えたもの: 中央のゲーム盤（六角形 → チェス8×8／囲碁9路の交点）

## 起動

```bash
python3 -m http.server 8000
# http://localhost:8000/index.html
```

`index.html` 1枚で動く静的アプリです（Tailwind は CDN 読み込み）。GitHub Pages にそのまま置けます。

## 開発・テスト

```bash
node dev/selftest.js        # エンジンの自己テスト（チェス/囲碁のルール検証）
node dev/smoke-cdp.js       # ブラウザE2E（要 HTTP サーバーと chrome-headless-shell）
```

`dev/selftest.js` は `index.html` 内の `/*ENGINE-START*/ … /*ENGINE-END*/` 区間を抽出して Node で実行します。チェスは perft（初期局面 depth 3 = 8902、Kiwipete depth 2 = 2039）まで検証しています。

E2E の前提:

```bash
python3 -m http.server 8123 --bind 127.0.0.1 &
chrome-headless-shell --headless --no-sandbox --remote-debugging-port=9222 about:blank &
node dev/smoke-cdp.js
```

スクリーンショットは `artifacts/` に出力されます。

## 構成

```
index.html            アプリ本体（HTML/CSS/JS 1ファイル）
dev/selftest.js       エンジン自己テスト（DOM非依存）
dev/smoke-cdp.js      CDP によるブラウザE2E
artifacts/            E2E のスクリーンショット
```

## 意図的に決めていないこと

- 混合ルールの詳細（碁石と駒の干渉、石の取り方、勝敗条件など）
- 持ち時間・時計
- コミ、盤サイズ（9路以外）、対局ルールの細部
- オンライン対戦（HEXAGO からは削除）
