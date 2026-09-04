# Issue #2 作業ログ

https://github.com/cyokodog/cyk-media-manager/issues/2

## 2026-09-04 画像一覧APIへの日時情報追加

### やったこと

`server.js` に `fileTimes()` を追加し、`GET /api/images` の各ファイルに
`birthtime` / `mtime` / `size` を含めるようにした。既存の `name` / `path`
はそのまま残している。

`birthtime` は環境によって取得できない（古い ext4 など）。その場合 Node は
`0` や `mtime` より後の値を返すため、`birthtimeMs > 0 && birthtimeMs <= mtimeMs`
を満たさないときは `mtime` にフォールバックする。

`statSync` が失敗した場合（一覧取得後に削除された等）は、一覧から落とさず
日時とサイズを `null` にして返す。一覧から消えるより挙動が読みやすいため。

### 決めたこと

- ディレクトリ一覧API（`/api/dirs`）は**作らない**。本ツールはスタンドアローンで
  利用する前提のため、フォルダ指定は手入力（＋履歴）とした。ブラウザは
  `input type="file"` で選んだファイルの絶対パスを返さない（ファイル名と相対パスのみ）
  ため、いずれにせよフォルダ選択ダイアログからパスは得られない。
  この判断で Issue #2 と #3 の完了条件を縮小している
- EXIF撮影日時は対象外。新規依存を避けるため（現在の依存は `express` のみ）

### 検証

1. **サーバー起動 + curl** — 1秒ずつずらして作成した3枚（`.png` / `.JPG` / `.gif`）で
   `birthtime` が作成順に増加すること、`size` が正しいこと、`.txt` が除外され
   大文字 `.JPG` が含まれることを確認。エラー系（404 / 400）も従来どおり
2. **フォールバック判定** — macOS では `birthtime` が常に取得できるため、`statSync` を
   差し替えて分岐を直接テスト。正常 / `birthtime=0` / `birthtime > mtime` /
   `birthtime == mtime` / 例外 の5ケースすべて期待どおり
3. **後方互換** — `public/app.js` が参照するのは `data.dir` / `data.files` /
   `f.name` / `f.path` のみ。すべて無変更のため既存画面は影響を受けない

### 検証していない点

- **古い ext4 等の実環境での動作**。macOS に該当するファイルシステムがないため、
  ロジックのテストのみで実機確認はしていない
- 既存画面をブラウザで開いての目視確認。レスポンスの後方互換で担保できると判断した

### ブランチ運用

この Issue から**ベースブランチ運用**に切り替えた。

```
main
 └── base/3col-rename-ui           ← #1 の一連をここに集める
      └── feat/2-image-api-timestamps
```

#3〜#7 も `base/3col-rename-ui` から切り、同ブランチへマージする。
すべて完了したら `base/3col-rename-ui` → `main` のPRを1本作る。
