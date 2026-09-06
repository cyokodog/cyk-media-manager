const { test, expect } = require('@playwright/test')
const path = require('path')

const FIXTURES = path.join(__dirname, 'fixtures')

// ネイティブ HTML5 D&D は Playwright の CDP マウスでは駆動できない
// （mouse.down 後の move でブラウザ側のドラッグに入り制御が戻らない）。
// 実装と同じ dragstart -> dragover -> drop を合成イベントで通す。
async function dragThumb(page, fromSelector, toSelector) {
  await page.evaluate(([from, to]) => {
    const src = document.querySelector(from)
    const dst = document.querySelector(to)
    if (!src || !dst) throw new Error('drag target not found: ' + from + ' -> ' + to)
    const dt = new DataTransfer()
    src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }))
    dst.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    dst.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    dst.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    src.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, [fromSelector, toSelector])
}

async function load(page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.fill('#dirInput', FIXTURES)
  await page.click('#loadBtn')
  await expect(page.locator('#leftBody .thumb')).toHaveCount(8)
}

const namesIn = sel => page => page.locator(sel).allTextContents()

test.beforeEach(async ({ page }) => { await load(page) })

test('右列が自然順ソートで表示される（img2 が img10 より前）', async ({ page }) => {
  const names = await page.locator('#rightBody .thumb .name').allTextContents()

  const i1 = names.indexOf('img1.png')
  const i2 = names.indexOf('img2.png')
  const i10 = names.indexOf('img10.png')
  expect(i1).toBeGreaterThanOrEqual(0)
  expect(i1).toBeLessThan(i2)
  expect(i2).toBeLessThan(i10)   // 単純な文字列ソートなら img10 < img2 になる

  // 単純な文字列ソートとは異なる並びであることを確かめる
  const plain = [...names].sort()
  expect(names).not.toEqual(plain)
})

test('左列が作成日順に表示され、各ファイルに作成日が出る', async ({ page }) => {
  // API の birthtime から期待順を導く（fixture を作り直しても壊れないように）
  const expected = await page.evaluate(async dir => {
    const res = await fetch(`/api/images?dir=${encodeURIComponent(dir)}`)
    const { files } = await res.json()
    return [...files]
      .sort((a, b) => Date.parse(a.birthtime) - Date.parse(b.birthtime))
      .map(f => f.name)
  }, FIXTURES)

  const shown = await page.locator('#leftBody .thumb .name').allTextContents()
  expect(shown).toEqual(expected)

  // 名前順とは別の並びになっている（作成日順が効いている証拠）
  const byName = await page.locator('#rightBody .thumb .name').allTextContents()
  expect(shown).not.toEqual(byName)

  await expect(page.locator('#leftBody .thumb .date')).toHaveCount(8)
  const date = await page.locator('#leftBody .thumb .date').first().textContent()
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('各列で昇順・降順を切り替えられる', async ({ page }) => {
  for (const [side, body, toggle] of [['左', '#leftBody', '#leftSort'], ['右', '#rightBody', '#rightSort']]) {
    const asc = await page.locator(`${body} .thumb .name`).allTextContents()
    await expect(page.locator(toggle)).toHaveAttribute('data-dir', 'asc')
    await expect(page.locator(`${toggle} .sort-label`)).toHaveText('昇順')

    await page.click(toggle)

    await expect(page.locator(toggle)).toHaveAttribute('data-dir', 'desc')
    await expect(page.locator(`${toggle} .sort-label`)).toHaveText('降順')
    const desc = await page.locator(`${body} .thumb .name`).allTextContents()
    expect(desc).toEqual([...asc].reverse())

    await page.click(toggle)   // 元に戻す
    await expect(page.locator(toggle)).toHaveAttribute('data-dir', 'asc')
  }
})

test('クリックで選択、cmd で複数、shift で範囲選択できる', async ({ page }) => {
  const thumbs = page.locator('#rightBody .thumb')

  await thumbs.nth(0).click()
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(1)

  // 修飾キーなしの単独クリックは選択を置き換える
  await thumbs.nth(2).click()
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(1)
  await expect(thumbs.nth(2)).toHaveClass(/selected/)

  // cmd/ctrl で追加
  await thumbs.nth(4).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(2)

  // 同じものを cmd クリックすると外れる
  await thumbs.nth(4).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(1)

  // shift で範囲
  await thumbs.nth(0).click()
  await thumbs.nth(3).click({ modifiers: ['Shift'] })
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(4)
})

test('片方の列で選択するともう片方の選択は解除される', async ({ page }) => {
  await page.locator('#leftBody .thumb').nth(0).click()
  await expect(page.locator('#leftBody .thumb.selected')).toHaveCount(1)

  await page.locator('#rightBody .thumb').nth(0).click()
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(1)
  await expect(page.locator('#leftBody .thumb.selected')).toHaveCount(0)
})

test('D&D で中央列へ投入でき、追加済みになる', async ({ page }) => {
  const src = page.locator('#rightBody .thumb').first()
  const name = await src.locator('.name').textContent()

  await dragThumb(page, '#rightBody .thumb', '#centerBody')

  await expect(page.locator('#centerBody .thumb')).toHaveCount(1)
  await expect(page.locator('#centerCount')).toHaveText('1 件')
  await expect(page.locator('#centerBody .thumb .name')).toHaveText(name)

  // 左右両方の列で追加済みになる
  await expect(page.locator(`#rightBody .thumb[data-name="${name}"]`)).toHaveClass(/added/)
  await expect(page.locator(`#leftBody .thumb[data-name="${name}"]`)).toHaveClass(/added/)
  await expect(page.locator(`#rightBody .thumb[data-name="${name}"] .added-badge`)).toBeVisible()
})

test('複数選択してまとめて投入できる', async ({ page }) => {
  const thumbs = page.locator('#rightBody .thumb')
  await thumbs.nth(0).click()
  await thumbs.nth(2).click({ modifiers: ['Shift'] })
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(3)

  const picked = await page.locator('#rightBody .thumb.selected .name').allTextContents()
  await dragThumb(page, '#rightBody .thumb:nth-child(2)', '#centerBody')

  await expect(page.locator('#centerBody .thumb')).toHaveCount(3)
  await expect(page.locator('#centerCount')).toHaveText('3 件')

  const inCenter = await page.locator('#centerBody .thumb .name').allTextContents()
  expect(inCenter.sort()).toEqual(picked.sort())
  await expect(page.locator('#rightBody .thumb.added')).toHaveCount(3)
})

test('追加済みは重複して投入できない', async ({ page }) => {
  const src = page.locator('#rightBody .thumb').first()
  const name = await src.locator('.name').textContent()
  await dragThumb(page, '#rightBody .thumb', '#centerBody')
  await expect(page.locator('#centerBody .thumb')).toHaveCount(1)

  // draggable が外れている
  await expect(page.locator(`#rightBody .thumb[data-name="${name}"]`)).toHaveAttribute('draggable', 'false')

  // 状態経由で再投入しようとしても増えない
  await page.evaluate(n => window.__cyk.addToTarget([n]), name)
  await expect(page.locator('#centerBody .thumb')).toHaveCount(1)
  await expect(page.locator('#centerCount')).toHaveText('1 件')

  // クリックしても選択されない
  await page.locator(`#rightBody .thumb[data-name="${name}"]`).click()
  await expect(page.locator('#rightBody .thumb.selected')).toHaveCount(0)
})

test('中央列から外すと追加済み表示が解除される', async ({ page }) => {
  const src = page.locator('#rightBody .thumb').first()
  const name = await src.locator('.name').textContent()
  await dragThumb(page, '#rightBody .thumb', '#centerBody')
  await expect(page.locator(`#rightBody .thumb[data-name="${name}"]`)).toHaveClass(/added/)

  // 中央列のサムネイルを左列へドラッグして戻す
  await dragThumb(page, '#centerBody .thumb', '#leftBody')

  await expect(page.locator('#centerBody .thumb')).toHaveCount(0)
  await expect(page.locator('#centerCount')).toHaveText('0 件')
  await expect(page.locator(`#rightBody .thumb[data-name="${name}"]`)).not.toHaveClass(/added/)
  await expect(page.locator(`#leftBody .thumb[data-name="${name}"]`)).not.toHaveClass(/added/)
  await expect(page.locator('#rightBody .added-badge')).toHaveCount(0)
})

test('ソートを切り替えても追加済み状態は保たれる', async ({ page }) => {
  const src = page.locator('#rightBody .thumb').first()
  const name = await src.locator('.name').textContent()
  await dragThumb(page, '#rightBody .thumb', '#centerBody')

  await page.click('#rightSort')
  await expect(page.locator(`#rightBody .thumb[data-name="${name}"]`)).toHaveClass(/added/)
  await expect(page.locator('#centerBody .thumb')).toHaveCount(1)
})

test('スクリーンショット（選択中・追加済み）', async ({ page }) => {
  const thumbs = page.locator('#rightBody .thumb')
  await thumbs.nth(0).click()
  await thumbs.nth(1).click({ modifiers: ['Shift'] })
  await dragThumb(page, '#rightBody .thumb', '#centerBody')
  await expect(page.locator('#centerBody .thumb')).toHaveCount(2)

  await page.locator('#leftBody .thumb:not(.added)').first().click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'e2e/__screenshots__/source-columns.png' })
})
