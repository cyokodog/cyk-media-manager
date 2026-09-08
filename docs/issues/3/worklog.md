# Issue #3 作業ログ

https://github.com/cyokodog/cyk-media-manager/issues/3

## 2026-09-05 3カラムレイアウトの骨格とヘッダーのフォルダ指定UI

### やったこと

`public/index.html` と `public/app.js` を全面的に書き換え、画面を
「ヘッダー + 3カラム + フッター」の3段構成にした。

デザイン（#7、`docs/issues/7/design/` の `Main.dc.html` / `FolderPicker.dc.html`）
のトークンを CSS 変数（`--accent` `--center-bg` など）に集約した。#4〜#6 は
この語彙を使って実装する。

ヘッダーはテキスト入力・履歴（localStorage、最大8件）・読み込みボタン・件数・
エラー表示。左右列は API 返却順のまま仮表示で、**ソートは #4 の担当**。
中央列は空状態のみ。

### 決めたこと

- **フッターは見た目だけ作り、確定ボタンは常に無効**にした。中央列が未実装の
  段階でリネームを動かすと壊れた状態になるため。配線は #6 で行う
- 既存の複数選択D&D（`toggleSelect` と Sortable の設定）は**持ち込まなかった**。
  #5 で SortableJS の MultiDrag に置き換えることが決まっているため
- **作成日は左列のみ表示**。当初は両列に出していたが、デザインに合わせて修正した
  （スクリーンショットの目視で気づいた）
- 履歴メニューの長いパスは `max-width` で抑える。`direction: rtl` で先頭を省略する
  案も試したが、日本語やカッコを含むパスで並びが崩れるため採用しなかった

### 検証

**Playwright を導入した**（このプロジェクトには型チェックもテストもなかった）。
`npm test` で実行できる。10テストすべて通過。

- 3段構成（存在 + 縦の並び順を座標で確認）
- 3カラムが高さいっぱい、3列とも `overflow-y: auto`、横スクロールなし
- 各列ヘッダーが `['作成日順', 'リネーム対象', '名前順']`
- パス入力・Enter キーでの読み込み、`notes.txt` 除外、大文字 `.PNG` 包含、
  画像が実際に描画されること（`naturalWidth > 0`）
- 作成日が左列のみ5件、右列0件
- 履歴の保存・復元・選択・重複排除・順序
- エラー表示と、入力し直したときの解除
- 中央列が空、フッターが無効

スクリーンショットも撮って目視確認した（`e2e/__screenshots__/`、gitignore 済み）。
これで上記の「作成日は左列のみ」と履歴メニューのはみ出しに気づいた。

### 検証していない点

- 実ブラウザでの手動操作。ヘッドレス Chromium のみで、Safari / Firefox は未確認
- 中央列への D&D は #4 / #5 の担当のため、この段階では確認していない

### E2E の資産

`playwright.config.js` は `webServer` でサーバーを自動起動する（`reuseExistingServer`）。
`e2e/fixtures/` は 1x1 の単色 PNG 5枚と `notes.txt`（除外確認用）。サムネイルの
見分けがつくよう色を変えてある。`e2e/__screenshots__/` と `test-results/` は
gitignore に追加した。

`package.json` の `test` を `playwright test` に変更した（従来は `exit 1` の
プレースホルダ）。
