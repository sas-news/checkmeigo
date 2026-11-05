# サードパーティ表記

## チェスの駒（SVG）

- **Chessnut piece set** — Alexis Luengas
- 配布元: https://github.com/LexLuengas/chessnut-pieces
- ライセンス: Apache License 2.0（全文: [LICENSES/chessnut-pieces-APACHE-2.0.txt](LICENSES/chessnut-pieces-APACHE-2.0.txt)）
- 本アプリでは 12 種の SVG（`wK/wQ/wR/wB/wN/wP/bK/bQ/bR/bB/bN/bP`）を改変せずに data URL として `index.html` に埋め込み、canvas と `<img>` に描画しています。

## デザインシステム

- **HEXAGO** — https://github.com/sas-news/hexago
- 流用範囲: Tailwind CSS の土台、CSS 変数テーマ、`.card` / `.btn` / `.opt` / `.dot`、ヘッダ、手番カード、canvas、操作ボタン列、結果バナー、各モーダル、テーマ切替、効果音、sessionStorage 保存の設計。
- 盤・ゲームロジック・AI・オンライン対戦などは HEXAGO から流用していません（削除済み）。
