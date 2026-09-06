# Issue #4 作業ログ

https://github.com/cyokodog/cyk-media-manager/issues/4

## 2026-09-05 左列・右列のソート表示と追加済み状態の管理

### 重要: SortableJS の MultiDrag は使えない

Issue #4 / #5 の前提に「SortableJS の MultiDrag プラグイン + `group` 設定に
置き換える」と書いていたが、**これは成立しない**。

CDN で読み込んでいる `sortablejs@1.15.2/Sortable.min.js` に `Sortable.MultiDrag`
が含まれておらず、`Sortable.MultiDrag is not a constructor` になる（実際に
ブラウザ上で確認済み）。プラグインは別ファイルで、このビルドには入っていない。

代わりに **HTML5 のネイティブ D&D** を使った。左右列は読み取り専用で DOM を
動かす必要がないため、SortableJS である必要がない。`dataTransfer` に
ファイル名の配列を JSON で載せて運ぶ。

**#5 への申し送り**: 中央列**内**の並べ替えには SortableJS をそのまま使える
（単一ドラッグなら問題ない）。複数まとめての並べ替えが必要なら、MultiDrag の
別ファイルを読み込むか、ネイティブ D&D で自前実装する。

### 状態管理（#5 との結合点）

単一の情報源は `state` オブジェクトで、DOM はその描画結果として扱う。
再描画で要素が入れ替わるため、**すべてファイル名をキー**にしている
（DOM 要素を Set に持つと再描画で即座に古くなる）。

```
state = {
  dir, files,                  // API の返却をそのまま保持
  targetOrder: string[],       // 中央列の並び
  sort: { left, right },       // 'asc' | 'desc'
  selected: { left: Set, right: Set },
  lastClicked: { left, right } // shift 範囲選択の起点
}
```

左右列は `files` から派生したソート済みビュー。「追加済み」は
`targetOrder.includes(name)` で判定する。

**#5 が使う API**（`window.__cyk` にも公開している）:

- `addToTarget(names)` — 中央列へ追加（重複と未知の名前は弾く）
- `removeFromTarget(names)` — 中央列から外す
- `clearTarget()` — 全クリア
- `renderAll()` — 3列すべて再描画

### 決めたこと

- **投入元は1列に限定**。片方の列で選択するともう片方の選択は解除する
- **追加済みは `draggable=false` かつクリックで選択もできない**。重複投入を
  UI 側で塞ぐ（`addToTarget` 側でも二重に弾いている）
- **中央列から外す手段**として、中央列のサムネイルを左右どちらかの列へ
  ドラッグして戻す操作を実装した。完了条件「追加済み表示が解除される」を
  満たすには削除手段が必要だったため。×ボタン・全クリアの UI は #5 が作る
- 名前順は `Intl.Collator(numeric: true)`。`sensitivity: 'base'` は使わない
  （`IMG_0002.PNG` と `img_0002.png` が同値になり順序が不定になる）
- 作成日順は `birthtime` が `null` のものを末尾へ送り、同値は名前でタイブレーク

### 検証

`npm test` で21テスト（既存10 + 新規11）すべて通過。

**fixture を追加した。** 既存の `IMG_0001〜0010` はすべてゼロ埋めで、
文字列ソートと自然順ソートの結果が**同一**になる。つまり自然順の検証に
なっていなかった。ゼロ埋めなしの `img1.png` / `img2.png` / `img10.png` を
足し、作成日順と名前順が別の並びになるよう作成時刻も交差させた。

`layout.spec.js` は枚数を 5 とハードコードしていたので、fixtures
ディレクトリから数えるようにした（今後増えても壊れない）。

### ハマった点: Playwright で D&D が駆動できない

`locator.dragTo()` も `page.mouse.down()` → `move()` も**タイムアウトする**。
`mouse.down` 後の `move` でブラウザがネイティブのドラッグに入り、CDP から
制御が戻らないため。Playwright の既知の制約で、アプリ側の不具合ではない
（`mouse.down` までは通り、次の `move` で固まることを切り分けで確認した）。

実装と同じ `dragstart` → `dragenter` → `dragover` → `drop` を合成 DragEvent で
発火させるヘルパー `dragThumb()` を書いて解決した。`DataTransfer` を共有すれば
ペイロードも正しく渡る。**#5 でも同じヘルパーが要る。**

### 検証していない点

- 実ブラウザでの手動 D&D。合成イベントは実装のハンドラを通るが、
  ブラウザのネイティブなドラッグ挙動（ドラッグ画像、カーソル形状）は未確認
- ヘッドレス Chromium のみ。Safari / Firefox は未確認
