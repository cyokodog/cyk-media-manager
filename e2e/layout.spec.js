const { test, expect } = require('@playwright/test')
const path = require('path')

const FIXTURES = path.join(__dirname, 'fixtures')

async function load(page, dir = FIXTURES) {
  await page.fill('#dirInput', dir)
  await page.click('#loadBtn')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('ヘッダー・3カラム・フッターの3段構成になっている', async ({ page }) => {
  await expect(page.locator('.header')).toBeVisible()
  await expect(page.locator('.main')).toBeVisible()
  await expect(page.locator('.footer')).toBeVisible()
  await expect(page.locator('.main .col')).toHaveCount(3)

  // 縦順に並んでいること
  const header = await page.locator('.header').boundingBox()
  const main = await page.locator('.main').boundingBox()
  const footer = await page.locator('.footer').boundingBox()
  expect(header.y + header.height).toBeLessThanOrEqual(main.y + 1)
  expect(main.y + main.height).toBeLessThanOrEqual(footer.y + 1)
})

test('3カラムが高さいっぱいで、各列が独立してスクロールする', async ({ page }) => {
  await load(page)
  await expect(page.locator('#leftBody .thumb')).toHaveCount(5)

  const vh = page.viewportSize().height
  const main = await page.locator('.main').boundingBox()
  const footer = await page.locator('.footer').boundingBox()
  // メインがヘッダーとフッターの間を埋めている
  expect(main.height).toBeGreaterThan(vh * 0.6)
  expect(Math.round(main.y + main.height)).toBe(Math.round(footer.y))

  // 各列の本体が独立したスクロールコンテナになっている
  const overflows = await page.locator('.col-body').evaluateAll(
    els => els.map(el => getComputedStyle(el).overflowY)
  )
  expect(overflows).toEqual(['auto', 'auto', 'auto'])

  // 横スクロールが発生していない
  const hasHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  expect(hasHScroll).toBe(false)
})

test('各列にヘッダーがあり役割が判別できる', async ({ page }) => {
  const titles = await page.locator('.col-header .title span').allTextContents()
  expect(titles).toEqual(['作成日順', 'リネーム対象', '名前順'])
})

test('テキスト入力でフォルダを指定して読み込める', async ({ page }) => {
  await load(page)

  // 画像5枚のみ（notes.txt は除外）
  await expect(page.locator('#leftBody .thumb')).toHaveCount(5)
  await expect(page.locator('#rightBody .thumb')).toHaveCount(5)
  await expect(page.locator('#count')).toHaveText('5 件')

  // 大文字拡張子も含まれる
  const names = await page.locator('#leftBody .thumb .name').allTextContents()
  expect(names).toContain('IMG_0002.PNG')
  expect(names).not.toContain('notes.txt')

  // サムネイル画像が実際に描画されている
  const loaded = await page.locator('#leftBody .thumb img').first()
    .evaluate(img => img.complete && img.naturalWidth > 0)
  expect(loaded).toBe(true)

  // 作成日は左列のみに表示される（デザイン #7）
  const date = await page.locator('#leftBody .thumb .date').first().textContent()
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  await expect(page.locator('#leftBody .thumb .date')).toHaveCount(5)
  await expect(page.locator('#rightBody .thumb .date')).toHaveCount(0)
})

test('Enter キーでも読み込める', async ({ page }) => {
  await page.fill('#dirInput', FIXTURES)
  await page.press('#dirInput', 'Enter')
  await expect(page.locator('#count')).toHaveText('5 件')
})

test('読み込み失敗時にエラーが表示される', async ({ page }) => {
  await load(page, '/no/such/folder')

  await expect(page.locator('#errorMsg')).toBeVisible()
  await expect(page.locator('#errorText')).toHaveText(/Directory not found|読み込みに失敗/)
  await expect(page.locator('.dir-field')).toHaveClass(/error/)
  await expect(page.locator('#count')).toHaveText('')

  // 入力し直すとエラーが消える
  await page.fill('#dirInput', FIXTURES)
  await expect(page.locator('#errorMsg')).toBeHidden()
})

test('履歴に保存され、選ぶと読み込まれる', async ({ page }) => {
  // 履歴が空のとき
  await page.click('#historyBtn')
  await expect(page.locator('.history-empty')).toBeVisible()
  await page.keyboard.press('Escape')

  await load(page)
  await expect(page.locator('#count')).toHaveText('5 件')

  // localStorage に入っている
  const stored = await page.evaluate(() => localStorage.getItem('cyk-media-manager:history'))
  expect(JSON.parse(stored)).toEqual([FIXTURES])

  // リロードで最後のパスが復元される
  await page.reload()
  await expect(page.locator('#dirInput')).toHaveValue(FIXTURES)

  // 履歴から選ぶと読み込まれる
  await page.click('#historyBtn')
  await expect(page.locator('.history-item')).toHaveCount(1)
  await expect(page.locator('.history-item .full')).toHaveText(FIXTURES)
  await page.click('.history-item')
  await expect(page.locator('#historyMenu')).toBeHidden()
  await expect(page.locator('#count')).toHaveText('5 件')
})

test('履歴は重複せず、新しいものが先頭に来る', async ({ page }) => {
  await load(page)
  await expect(page.locator('#count')).toHaveText('5 件')

  // 親ディレクトリには画像がないので 0 件になるのを待つ
  const parent = path.dirname(FIXTURES)
  await load(page, parent)
  await expect(page.locator('#count')).toHaveText('0 件')

  // もう一度 fixtures を読み、履歴の先頭に来ることを確認する
  await load(page, FIXTURES)
  await expect(page.locator('#count')).toHaveText('5 件')

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cyk-media-manager:history')))
  expect(stored[0]).toBe(FIXTURES)
  expect(stored.filter(p => p === FIXTURES)).toHaveLength(1)
})

test('中央列は空状態、フッターは無効', async ({ page }) => {
  await load(page)
  await expect(page.locator('#count')).toHaveText('5 件')

  // 中央列は空のまま（#4 / #5 で投入できるようになる）
  await expect(page.locator('#centerBody .thumb')).toHaveCount(0)
  await expect(page.locator('#centerBody .empty')).toBeVisible()
  await expect(page.locator('#centerCount')).toHaveText('0 件')

  // フッターは見た目のみ。#6 で配線する
  await expect(page.locator('#renameBtn')).toBeDisabled()
  await expect(page.locator('#previewBtn')).toBeDisabled()
  await expect(page.locator('#prefixInput')).toBeDisabled()
})

test('スクリーンショット', async ({ page }, testInfo) => {
  await load(page)
  await expect(page.locator('#leftBody .thumb')).toHaveCount(5)
  await page.waitForTimeout(300)
  await testInfo.attach('loaded', { body: await page.screenshot(), contentType: 'image/png' })
  await page.screenshot({ path: 'e2e/__screenshots__/loaded.png' })

  await page.click('#historyBtn')
  await page.screenshot({ path: 'e2e/__screenshots__/history.png' })
  await page.keyboard.press('Escape')

  await load(page, '/no/such/folder')
  await expect(page.locator('#errorMsg')).toBeVisible()
  await page.screenshot({ path: 'e2e/__screenshots__/error.png' })
})
