const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

// 実際にファイル名を変えるので、使い捨てディレクトリで検証する
const PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'img1.png'))

function makeDir(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyk-inline-'))
  names.forEach(n => fs.writeFileSync(path.join(dir, n), PNG))
  return dir
}
const ls = dir => fs.readdirSync(dir).sort()

async function loadDir(page, dir) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.fill('#dirInput', dir)
  await page.click('#loadBtn')
  await expect(page.locator('#rightBody .thumb')).toHaveCount(ls(dir).length)
}

const nameCell = (name) => `#rightBody .thumb[data-name="${name}"] .name`

// locator.dblclick() は draggable な要素の上で dblclick を発火できないため、
// 実際のマウス操作（同一座標への2連クリック）で編集を開始する
async function startEdit(page, selector) {
  const b = await page.locator(selector).boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { clickCount: 2, delay: 30 })
  await expect(page.locator('.name-edit')).toBeVisible()
}

test('ダブルクリックで編集状態になり、拡張子は含まれない', async ({ page }) => {
  const dir = makeDir(['photo.png', 'other.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))

  const input = page.locator('#rightBody .name-edit')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('photo')          // 拡張子は除かれる
  await expect(input).toBeFocused()

  // 全選択されている
  const selected = await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))
  expect(selected).toBe('photo')
})

test('Enter で確定し、実際にリネームされる', async ({ page }) => {
  const dir = makeDir(['photo.png', 'other.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))
  await page.fill('#rightBody .name-edit', '夕焼け')
  await page.press('#rightBody .name-edit', 'Enter')

  await expect(page.locator(nameCell('夕焼け.png'))).toBeVisible()
  expect(ls(dir)).toEqual(['other.png', '夕焼け.png'])
})

test('Esc で取り消され、元の名前に戻る', async ({ page }) => {
  const dir = makeDir(['photo.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))
  await page.fill('#rightBody .name-edit', 'changed')
  await page.press('#rightBody .name-edit', 'Escape')

  await expect(page.locator('#rightBody .name-edit')).toHaveCount(0)
  await expect(page.locator(nameCell('photo.png'))).toHaveText('photo.png')
  expect(ls(dir)).toEqual(['photo.png'])
})

test('フォーカスが外れても確定される', async ({ page }) => {
  const dir = makeDir(['photo.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))
  await page.fill('#rightBody .name-edit', 'blurred')
  await page.locator('#dirInput').focus()

  await expect(page.locator(nameCell('blurred.png'))).toBeVisible()
  expect(ls(dir)).toEqual(['blurred.png'])
})

test('名前を変えずに確定しても何も起きない', async ({ page }) => {
  const dir = makeDir(['photo.png'])
  await loadDir(page, dir)
  const before = fs.statSync(path.join(dir, 'photo.png')).mtimeMs

  await startEdit(page, nameCell('photo.png'))
  await page.press('#rightBody .name-edit', 'Enter')

  await expect(page.locator('#rightBody .name-edit')).toHaveCount(0)
  expect(ls(dir)).toEqual(['photo.png'])
  expect(fs.statSync(path.join(dir, 'photo.png')).mtimeMs).toBe(before)
})

test('空文字では確定されない', async ({ page }) => {
  const dir = makeDir(['photo.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))
  await page.fill('#rightBody .name-edit', '   ')
  await page.press('#rightBody .name-edit', 'Enter')

  await expect(page.locator(nameCell('photo.png'))).toBeVisible()
  expect(ls(dir)).toEqual(['photo.png'])
})

test('既存ファイルと同名にはできない', async ({ page }) => {
  const dir = makeDir(['photo.png', 'taken.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))
  await page.fill('#rightBody .name-edit', 'taken')
  await page.press('#rightBody .name-edit', 'Enter')

  await expect(page.locator('#errorMsg')).toBeVisible()
  await expect(page.locator('#errorText')).toContainText('同じ名前のファイルが既にあります')
  expect(ls(dir)).toEqual(['photo.png', 'taken.png'])
})

test('パス区切り文字は受け付けない', async ({ page }) => {
  const dir = makeDir(['photo.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))
  await page.fill('#rightBody .name-edit', '../escaped')
  await page.press('#rightBody .name-edit', 'Enter')

  await expect(page.locator('#errorMsg')).toBeVisible()
  await expect(page.locator('#errorText')).toContainText('パス区切り文字')
  expect(ls(dir)).toEqual(['photo.png'])
})

test('リネーム後に並び順が更新される', async ({ page }) => {
  const dir = makeDir(['b.png', 'c.png'])
  await loadDir(page, dir)
  expect(await page.locator('#rightBody .thumb .name').allTextContents()).toEqual(['b.png', 'c.png'])

  // b を z にすると名前順で後ろへ移動する
  await startEdit(page, nameCell('b.png'))
  await page.fill('#rightBody .name-edit', 'z')
  await page.press('#rightBody .name-edit', 'Enter')

  await expect(page.locator(nameCell('z.png'))).toBeVisible()
  expect(await page.locator('#rightBody .thumb .name').allTextContents()).toEqual(['c.png', 'z.png'])
})

test('中央列に投入済みのファイルは編集できない', async ({ page }) => {
  const dir = makeDir(['photo.png', 'other.png'])
  await loadDir(page, dir)
  await page.evaluate(() => window.__cyk.addToTarget(['photo.png']))
  await expect(page.locator('#centerBody .thumb')).toHaveCount(1)

  // 編集状態にならないので startEdit（出現を待つ）は使えない
  const b = await page.locator(nameCell('photo.png')).boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { clickCount: 2, delay: 30 })
  await page.waitForTimeout(400)

  await expect(page.locator('.name-edit')).toHaveCount(0)
  expect(ls(dir)).toEqual(['other.png', 'photo.png'])
})

test('左列でも編集できる', async ({ page }) => {
  const dir = makeDir(['photo.png'])
  await loadDir(page, dir)

  await startEdit(page, `#leftBody .thumb[data-name="photo.png"] .name`)
  await expect(page.locator('#leftBody .name-edit')).toBeVisible()
  await page.fill('#leftBody .name-edit', 'left-renamed')
  await page.press('#leftBody .name-edit', 'Enter')

  await expect(page.locator('#leftBody .thumb[data-name="left-renamed.png"]')).toBeVisible()
  expect(ls(dir)).toEqual(['left-renamed.png'])
})

test('大文字小文字だけの変更ができる', async ({ page }) => {
  const dir = makeDir(['photo.png'])
  await loadDir(page, dir)

  await startEdit(page, nameCell('photo.png'))
  await page.fill('#rightBody .name-edit', 'Photo')
  await page.press('#rightBody .name-edit', 'Enter')

  await expect(page.locator('#rightBody .thumb[data-name="Photo.png"]')).toBeVisible()
  await expect(page.locator('#errorMsg')).toBeHidden()
  expect(ls(dir)).toEqual(['Photo.png'])
})
