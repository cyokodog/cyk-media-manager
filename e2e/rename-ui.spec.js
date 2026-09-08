const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

// リネームは破壊的なので、テストごとに使い捨てのディレクトリを作る。
// e2e/fixtures には絶対に触らない。
const PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'img1.png'))

function makeDir(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyk-ui-'))
  names.forEach(n => fs.writeFileSync(path.join(dir, n), PNG))
  return dir
}
const ls = dir => fs.readdirSync(dir).sort()

// 1x1 の単色 PNG を作る（サムネイルの中身を見分けるため）
function solidPng(rgb) {
  const zlib = require('zlib')
  const ct = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; ct[n] = c >>> 0 }
  const chunk = (t, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length)
    const td = Buffer.concat([Buffer.from(t), d])
    let c = 0xFFFFFFFF
    for (const b of td) c = ct[(c ^ b) & 0xFF] ^ (c >>> 8)
    const cb = Buffer.alloc(4); cb.writeUInt32BE((c ^ 0xFFFFFFFF) >>> 0)
    return Buffer.concat([l, td, cb])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, ...rgb, 255]))), chunk('IEND', Buffer.alloc(0))
  ])
}

// img が実際に描画しているピクセルの色を読む
async function thumbColors(page, selector) {
  return page.locator(selector).evaluateAll(imgs => imgs.map(img => {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    if (r > 150 && g < 100) return '赤'
    if (g > 150 && r < 100) return '緑'
    if (b > 150 && r < 100) return '青'
    return `?(${r},${g},${b})`
  }))
}


async function loadDir(page, dir) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.fill('#dirInput', dir)
  await page.click('#loadBtn')
  await expect(page.locator('#rightBody .thumb')).toHaveCount(ls(dir).length)
}

async function addAll(page, names) {
  await page.evaluate(ns => window.__cyk.addToTarget(ns), names)
  await expect(page.locator('#centerBody .thumb')).toHaveCount(names.length)
}

test('プレフィックス未入力・対象0件では確定できない', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png'])
  await loadDir(page, dir)

  // 対象0件
  await expect(page.locator('#renameBtn')).toBeDisabled()
  await expect(page.locator('#previewBtn')).toBeDisabled()
  await expect(page.locator('#targetCount')).toHaveText('対象 0 件')

  // 対象はあるがプレフィックス未入力
  await addAll(page, ['a.png'])
  await expect(page.locator('#targetCount')).toHaveText('対象 1 件')
  await expect(page.locator('#renameBtn')).toBeDisabled()
  await expect(page.locator('#sampleName')).toHaveText('プレフィックスを入力してください')

  // 両方揃うと有効になる
  await page.fill('#prefixInput', '花_ひまわり')
  await expect(page.locator('#renameBtn')).toBeEnabled()
  await expect(page.locator('#previewBtn')).toBeEnabled()
})

test('確定後のファイル名の例が表示される', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png', 'c.png'])
  await loadDir(page, dir)
  await addAll(page, ['a.png', 'b.png', 'c.png'])
  await page.fill('#prefixInput', '花_ひまわり')

  await expect(page.locator('#sampleName'))
    .toHaveText('花_ひまわり_0010.png → 花_ひまわり_0030.png')
})

test('中央列の連番表示がフッターの設定に連動する', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png'])
  await loadDir(page, dir)
  await addAll(page, ['a.png', 'b.png'])

  expect(await page.locator('.seq-badge').allTextContents()).toEqual(['0010', '0020'])

  await page.fill('#digitsInput', '3')
  await page.fill('#startInput', '1')
  await page.fill('#stepInput', '1')
  expect(await page.locator('.seq-badge').allTextContents()).toEqual(['001', '002'])

  await page.fill('#startInput', '100')
  await page.fill('#stepInput', '5')
  expect(await page.locator('.seq-badge').allTextContents()).toEqual(['100', '105'])
})

test('プレビューで変更前→変更後の一覧を確認できる', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.PNG'])
  await loadDir(page, dir)
  await addAll(page, ['a.png', 'b.PNG'])
  await page.fill('#prefixInput', '花_ひまわり')
  await page.click('#previewBtn')

  await expect(page.locator('#modalBackdrop')).toBeVisible()
  await expect(page.locator('#modalSub')).toHaveText('2 件を変更します')
  await expect(page.locator('#modalDir')).toHaveText(dir)

  expect(await page.locator('.modal-row .from').allTextContents()).toEqual(['a.png', 'b.PNG'])
  // 拡張子は小文字化される
  expect(await page.locator('.modal-row .to .label').allTextContents())
    .toEqual(['花_ひまわり_0010.png', '花_ひまわり_0020.png'])

  await expect(page.locator('#modalWarning')).toBeHidden()
  await expect(page.locator('#modalApply')).toBeEnabled()

  await page.click('#modalCancel')
  await expect(page.locator('#modalBackdrop')).toBeHidden()
  // キャンセルしたのでファイルは変わっていない
  expect(ls(dir)).toEqual(['a.png', 'b.PNG'])
})

test('衝突するファイルがプレビューで判別でき、実行できない', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png', '花_ひまわり_0020.png'])
  await loadDir(page, dir)
  await addAll(page, ['a.png', 'b.png'])
  await page.fill('#prefixInput', '花_ひまわり')
  await page.click('#previewBtn')

  await expect(page.locator('#modalWarning')).toBeVisible()
  await expect(page.locator('#modalWarnTitle')).toHaveText('1 件が既存のファイルと衝突します')
  await expect(page.locator('.modal-row.collide')).toHaveCount(1)
  await expect(page.locator('.modal-row.collide .tag')).toHaveText('既存')
  await expect(page.locator('#modalApply')).toBeDisabled()
  await expect(page.locator('#modal')).toHaveClass(/has-collision/)
})

test('モーダル内で開始番号を変えると衝突を回避できる', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png', '花_ひまわり_0020.png'])
  await loadDir(page, dir)
  await addAll(page, ['a.png', 'b.png'])
  await page.fill('#prefixInput', '花_ひまわり')
  await page.click('#previewBtn')
  await expect(page.locator('#modalApply')).toBeDisabled()

  // 開始を 100 にすれば 0020 とぶつからない
  await page.fill('#modalStart', '100')

  await expect(page.locator('#modalWarning')).toBeHidden()
  await expect(page.locator('.modal-row.collide')).toHaveCount(0)
  await expect(page.locator('#modalApply')).toBeEnabled()
  // フッター側の開始番号も追従する
  await expect(page.locator('#startInput')).toHaveValue('100')
})

test('リネームが実行され、対象外は変更されない', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png', 'keep.png'])
  await loadDir(page, dir)
  await addAll(page, ['a.png', 'b.png'])
  await page.fill('#prefixInput', '花_ひまわり')
  await page.click('#previewBtn')
  await expect(page.locator('#modalApply')).toBeEnabled()
  await page.click('#modalApply')

  await expect(page.locator('#modalBackdrop')).toBeHidden()
  await expect(page.locator('#count')).toContainText('2 件をリネームしました')

  // keep.png は手つかず
  expect(ls(dir)).toEqual(['keep.png', '花_ひまわり_0010.png', '花_ひまわり_0020.png'])
  expect(fs.readdirSync(dir).filter(f => f.includes('__tmp__'))).toEqual([])
})

test('リネーム後も中央列が新しい名前で並び順を保つ', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png', 'c.png'])
  await loadDir(page, dir)
  // わざと逆順に入れる
  await addAll(page, ['c.png', 'a.png', 'b.png'])
  await page.fill('#prefixInput', 'x')
  await page.click('#previewBtn')
  await expect(page.locator('#modalBackdrop')).toBeVisible()
  await expect(page.locator('.modal-row')).toHaveCount(3)

  expect(await page.locator('.modal-row .from').allTextContents()).toEqual(['c.png', 'a.png', 'b.png'])
  await page.click('#modalApply')

  // リネーム後は /api/images を読み直すので、反映を待つ
  await expect(page.locator('#centerBody .thumb .name').first()).toHaveText('x_0010.png')
  await expect(page.locator('#centerBody .thumb')).toHaveCount(3)
  expect(await page.locator('#centerBody .thumb .name').allTextContents())
    .toEqual(['x_0010.png', 'x_0020.png', 'x_0030.png'])
  expect(await page.locator('.seq-badge').allTextContents()).toEqual(['0010', '0020', '0030'])

  // 中央列の中身は追加済みのまま
  await expect(page.locator('#rightBody .thumb.added')).toHaveCount(3)
})

test('スクリーンショット（プレビュー・衝突）', async ({ page }) => {
  const dir = makeDir(['a.png', 'b.png', 'c.png'])
  await loadDir(page, dir)
  await addAll(page, ['a.png', 'b.png', 'c.png'])
  await page.fill('#prefixInput', '花_ひまわり')
  await page.click('#previewBtn')
  await expect(page.locator('.modal-row')).toHaveCount(3)
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'e2e/__screenshots__/preview.png' })
  await page.click('#modalCancel')

  const dir2 = makeDir(['a.png', 'b.png', '花_ひまわり_0020.png'])
  await loadDir(page, dir2)
  await addAll(page, ['a.png', 'b.png'])
  await page.fill('#prefixInput', '花_ひまわり')
  await page.click('#previewBtn')
  await expect(page.locator('#modalWarning')).toBeVisible()
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'e2e/__screenshots__/preview-collision.png' })
})

test('リネーム後にサムネイルが新しい画像に差し替わる', async ({ page }) => {
  // 同じパスに別の画像が入るため、キャッシュが効くと古いサムネイルが残る
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyk-thumb-'))
  fs.writeFileSync(path.join(dir, 'b_0010.png'), solidPng([220, 60, 60]))   // 赤
  fs.writeFileSync(path.join(dir, 'b_0020.png'), solidPng([60, 200, 90]))   // 緑
  fs.writeFileSync(path.join(dir, 'b_0030.png'), solidPng([70, 110, 230]))  // 青

  await loadDir(page, dir)
  // 青を先頭にして投入する
  await addAll(page, ['b_0030.png', 'b_0010.png', 'b_0020.png'])
  await page.waitForTimeout(200)
  expect(await thumbColors(page, '#centerBody .thumb img')).toEqual(['青', '赤', '緑'])

  await page.fill('#prefixInput', 'b')
  await page.click('#previewBtn')
  await expect(page.locator('.modal-row')).toHaveCount(3)
  await page.click('#modalApply')
  await expect(page.locator('#modalBackdrop')).toBeHidden()
  await expect(page.locator('#centerBody .thumb .name').first()).toHaveText('b_0010.png')
  await page.waitForTimeout(300)

  // 名前は昇順になるが、画像は並べ替えた順のまま
  expect(await page.locator('#centerBody .thumb .name').allTextContents())
    .toEqual(['b_0010.png', 'b_0020.png', 'b_0030.png'])
  expect(await thumbColors(page, '#centerBody .thumb img')).toEqual(['青', '赤', '緑'])
})
