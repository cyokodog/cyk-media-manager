const { test, expect } = require('@playwright/test')
const path = require('path')

const FIXTURES = path.join(__dirname, 'fixtures')

// ネイティブ D&D は Playwright のマウスでは駆動できないため合成イベントで通す。
// clientX/clientY を渡せるので、並べ替えの挿入位置も指定できる。
async function drag(page, fromSelector, toSelector, point) {
  await page.evaluate(([from, to, pt]) => {
    const src = document.querySelector(from)
    const dst = document.querySelector(to)
    if (!src || !dst) throw new Error('not found: ' + from + ' -> ' + to)
    const dt = new DataTransfer()
    const r = dst.getBoundingClientRect()
    const coords = pt || { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    const mk = (type) => new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, ...coords })
    src.dispatchEvent(mk('dragstart'))
    dst.dispatchEvent(mk('dragenter'))
    dst.dispatchEvent(mk('dragover'))
    dst.dispatchEvent(mk('drop'))
    src.dispatchEvent(mk('dragend'))
  }, [fromSelector, toSelector, point])
}

// name のサムネイルの「左端」を狙って、その手前へ挿入する
async function dropBefore(page, fromSelector, targetName) {
  const box = await page.locator(`#centerBody .thumb[data-name="${targetName}"]`).boundingBox()
  await drag(page, fromSelector, '#centerBody', {
    clientX: box.x + 2, clientY: box.y + box.height / 2
  })
}

const centerNames = page => page.locator('#centerBody .thumb .name').allTextContents()

async function seed(page, howMany) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.fill('#dirInput', FIXTURES)
  await page.click('#loadBtn')
  await expect(page.locator('#rightBody .thumb')).toHaveCount(8)

  const names = (await page.locator('#rightBody .thumb .name').allTextContents()).slice(0, howMany)
  await page.evaluate(ns => window.__cyk.addToTarget(ns), names)
  await expect(page.locator('#centerBody .thumb')).toHaveCount(howMany)
  return names
}

test('左右どちらの列からのD&Dも受け入れる', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.fill('#dirInput', FIXTURES)
  await page.click('#loadBtn')
  await expect(page.locator('#rightBody .thumb')).toHaveCount(8)

  await drag(page, '#rightBody .thumb', '#centerBody')
  await expect(page.locator('#centerBody .thumb')).toHaveCount(1)

  await drag(page, '#leftBody .thumb:not(.added)', '#centerBody')
  await expect(page.locator('#centerBody .thumb')).toHaveCount(2)
})

test('中央列内のD&Dで並べ替えられる', async ({ page }) => {
  const names = await seed(page, 4)
  expect(await centerNames(page)).toEqual(names)

  // 4番目を先頭へ
  await dropBefore(page, `#centerBody .thumb[data-name="${names[3]}"]`, names[0])

  const after = await centerNames(page)
  expect(after).toEqual([names[3], names[0], names[1], names[2]])
})

test('複数ファイルをまとめて並べ替えられる', async ({ page }) => {
  const names = await seed(page, 5)

  // 4番目と5番目を選択して先頭へ
  await page.locator(`#centerBody .thumb[data-name="${names[3]}"]`).click()
  await page.locator(`#centerBody .thumb[data-name="${names[4]}"]`).click({ modifiers: ['Shift'] })
  await expect(page.locator('#centerBody .thumb.selected')).toHaveCount(2)

  await dropBefore(page, `#centerBody .thumb[data-name="${names[3]}"]`, names[0])

  const after = await centerNames(page)
  expect(after).toEqual([names[3], names[4], names[0], names[1], names[2]])
})

test('cmd クリックでトグル、shift クリックで範囲選択できる', async ({ page }) => {
  const names = await seed(page, 5)
  const thumbs = page.locator('#centerBody .thumb')

  await thumbs.nth(0).click()
  await expect(page.locator('#centerBody .thumb.selected')).toHaveCount(1)

  await thumbs.nth(2).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.locator('#centerBody .thumb.selected')).toHaveCount(2)

  await thumbs.nth(2).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.locator('#centerBody .thumb.selected')).toHaveCount(1)

  await thumbs.nth(0).click()
  await thumbs.nth(3).click({ modifiers: ['Shift'] })
  await expect(page.locator('#centerBody .thumb.selected')).toHaveCount(4)
})

test('連番が表示され、並べ替えに追従して更新される', async ({ page }) => {
  const names = await seed(page, 4)

  // 既定値は 4桁 / 開始10 / ステップ10
  expect(await page.locator('#centerBody .seq-badge').allTextContents())
    .toEqual(['0010', '0020', '0030', '0040'])

  // 先頭にあったファイルが3番目に来たら連番も 0030 になる
  await dropBefore(page, `#centerBody .thumb[data-name="${names[3]}"]`, names[0])

  expect(await page.locator('#centerBody .seq-badge').allTextContents())
    .toEqual(['0010', '0020', '0030', '0040'])
  const first = await page.locator('#centerBody .thumb').first().getAttribute('data-name')
  expect(first).toBe(names[3])
})

test('ヘッダーに対象件数が表示される', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#centerCount')).toHaveText('0 件')
  await seed(page, 3)
  await expect(page.locator('#centerCount')).toHaveText('3 件')
})

test('全クリアボタンで中央列を空にできる', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#clearBtn')).toBeDisabled()

  await seed(page, 3)
  await expect(page.locator('#clearBtn')).toBeEnabled()

  await page.click('#clearBtn')
  await expect(page.locator('#centerBody .thumb')).toHaveCount(0)
  await expect(page.locator('#centerCount')).toHaveText('0 件')
  await expect(page.locator('#clearBtn')).toBeDisabled()
  await expect(page.locator('#centerBody .empty')).toBeVisible()

  // 追加済み表示も解除される
  await expect(page.locator('#rightBody .thumb.added')).toHaveCount(0)
})

test('各サムネイルから個別に削除できる', async ({ page }) => {
  const names = await seed(page, 3)

  // 削除ボタンはホバー時のみ表示される
  await page.locator(`#centerBody .thumb[data-name="${names[1]}"]`).hover()
  await page.locator(`#centerBody .thumb[data-name="${names[1]}"] .remove-btn`).click()

  await expect(page.locator('#centerBody .thumb')).toHaveCount(2)
  expect(await centerNames(page)).toEqual([names[0], names[2]])
  await expect(page.locator('#centerCount')).toHaveText('2 件')

  // 削除したものは追加済みが外れ、残りは付いたまま
  await expect(page.locator(`#rightBody .thumb[data-name="${names[1]}"]`)).not.toHaveClass(/added/)
  await expect(page.locator(`#rightBody .thumb[data-name="${names[0]}"]`)).toHaveClass(/added/)

  // 連番が振り直される
  expect(await page.locator('#centerBody .seq-badge').allTextContents()).toEqual(['0010', '0020'])
})

test('削除ボタンのクリックで選択が変わらない', async ({ page }) => {
  const names = await seed(page, 3)
  await page.locator(`#centerBody .thumb[data-name="${names[0]}"]`).click()
  await expect(page.locator('#centerBody .thumb.selected')).toHaveCount(1)

  await page.locator(`#centerBody .thumb[data-name="${names[2]}"]`).hover()
  await page.locator(`#centerBody .thumb[data-name="${names[2]}"] .remove-btn`).click()

  await expect(page.locator('#centerBody .thumb')).toHaveCount(2)
  await expect(page.locator(`#centerBody .thumb[data-name="${names[0]}"]`)).toHaveClass(/selected/)
})

test('中央列内のドロップで誤って削除されない', async ({ page }) => {
  const names = await seed(page, 3)
  // 中央列内で並べ替えても件数が減らないこと（remove 用の MIME も載せているため）
  await dropBefore(page, `#centerBody .thumb[data-name="${names[2]}"]`, names[0])
  await expect(page.locator('#centerBody .thumb')).toHaveCount(3)
  await expect(page.locator('#centerCount')).toHaveText('3 件')
})

test('SortableJS に依存していない', async ({ page }) => {
  await page.goto('/')
  expect(await page.evaluate(() => typeof window.Sortable)).toBe('undefined')
})

test('スクリーンショット（中央列）', async ({ page }) => {
  const names = await seed(page, 5)
  await page.locator(`#centerBody .thumb[data-name="${names[1]}"]`).click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'e2e/__screenshots__/center-column.png' })
})
