# UIデザイン（Issue #7）

3カラム構成による連番リネームUIのデザイン。

## 成果物

https://claude.ai/code/artifact/64fb62dc-baba-4d40-ba2d-fb4523f37231

公開範囲は作成者のみ（非公開）。同じアカウントでログインすれば別マシンからも開ける。

Artifact を開けない場合は `cyk-media-manager-ui.html` をブラウザで直接開く。単体で同じキャンバスが表示される。

## アートボード

| ファイル | 内容 | 参照する実装Issue |
|---|---|---|
| `Main.dc.html` | 全体レイアウト（ヘッダー + 3カラム + フッター、1440×900） | #3 |
| `FolderPicker.dc.html` | ヘッダーのフォルダ指定（テキスト入力・履歴・ディレクトリブラウザ・エラー） | #3 |
| `SourceColumns.dc.html` | 左列・右列（通常/選択中/追加済み/ドラッグ中、複数選択のまとめドラッグ） | #4 |
| `CenterColumn.dc.html` | 中央列（連番表示・個別削除・挿入位置ライン・空状態） | #5 |
| `Footer.dc.html` | フッター（通常/未入力/0件/実行中/完了） | #6 |
| `RenameModal.dc.html` | リネーム確認モーダル（衝突なし・衝突あり） | #6 |

`canvas.json` は各アートボードのキャンバス上の配置と注釈を定義する。

## デザイントークン

既存実装（`public/index.html`）から実値を採取して踏襲している。

| 用途 | 値 |
|---|---|
| 背景 | `#1a1a1a` |
| パネル・ヘッダー・フッター | `#2a2a2a` |
| 入力欄 | `#3a3a3a` |
| 枠線 | `#444` |
| アクセント | `#4a7cf7`（ホバー `#3a6ce7`） |
| 選択中の背景 | `#1e3a6e` |
| テキスト | `#eee` / `#aaa` / `#888` / `#666` |
| 警告 | `#e0705f` / `#f0a89c` / 背景 `#33201f` |
| 角丸 | 4px（コントロール）/ 6px（サムネイル）/ 8px（モーダル） |
| フォント | `system-ui`。連番とパスのみ `ui-monospace` 系（桁揃えのため新規追加） |
| フォントサイズ | 13px（コントロール）/ 12px（ラベル）/ 10px（サムネイルのファイル名） |

中央列のみ背景 `#1e1e1e`、ヘッダー `#262b38` として左右列と区別する。

## 設計上の判断

- **中央列を色で区別** — 左右の読み取り専用プールと、リネーム対象である中央列を一目で分けるため
- **連番はサムネイル左上のバッジ** — ファイル名と競合せず、並べ替え中も追従が見える位置
- **追加済みは不透明度 0.4 + チェックバッジ** — グレーアウトのみだと「読み込み失敗」と区別が付かないため
- **衝突時は実行ボタンを無効化** — スキップ・上書きの選択肢は出さず、開始番号での回避に誘導する。モーダルのフッターに開始番号の入力欄を置き、その場で直せるようにした
- **拡張子の小文字化を明示** — 確認モーダルの注記に `IMG_4477.JPG` → `花_ひまわり_0040.jpg` の例を入れた

## 未確定（実装時に判断する）

- サムネイルのグリッド列数。3列固定で描いたが、列幅に応じた可変でもよい
- 履歴の保持件数。4件で描画している
- ディレクトリブラウザの画像枚数表示。あると便利だが `/api/dirs` の実装コストと引き換えのため、不要なら省略可

## 修正のしかた

`.dc.html` と `canvas.json` が原本で、`cyk-media-manager-ui.html` はそこから生成した成果物。デザインを直すときは原本を編集して再生成する。

`cyk-media-manager-ui.html` は原本のソースをそのまま埋め込んだ上に、キャンバスエディタのコード（約2.5MB）を含む。サイズの大半はエディタ。

### 再生成

Claude Code で `/design` を起動するとスキルが展開され、その base directory に `seed-canvas.mjs` と `payload.template.html` が置かれる。パスは展開のたびに変わるため、起動時に表示されるものを使う。

```bash
cd docs/issues/7/design

node "<base directory>/seed-canvas.mjs" \
  --template "<base directory>/payload.template.html" \
  --out cyk-media-manager-ui.html \
  --title "cyk-media-manager UI" \
  --artboard Main.dc.html \
  --artboard FolderPicker.dc.html \
  --artboard SourceColumns.dc.html \
  --artboard CenterColumn.dc.html \
  --artboard Footer.dc.html \
  --artboard RenameModal.dc.html \
  --canvas canvas.json

# 生成物の検証
node "<base directory>/seed-canvas.mjs" --check cyk-media-manager-ui.html
```

生成後、Artifact ツールで上記URLに再公開すると同じリンクのまま更新される。

### 原本を失った場合

Artifact から原本を復元できる。

```bash
node "<base directory>/seed-canvas.mjs" --extract <保存したページ> --to <空のディレクトリ>
```

ただしこれは非常手段。原本はこのディレクトリで管理する。
