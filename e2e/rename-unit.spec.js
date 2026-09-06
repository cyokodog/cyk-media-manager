const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { buildRenamePlan, applyRenamePlan, clampInt } = require('../server')

function tmpDirWith(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyk-rename-'))
  names.forEach(n => fs.writeFileSync(path.join(dir, n), n))
  return dir
}
const ls = dir => fs.readdirSync(dir).sort()

test.describe('buildRenamePlan', () => {
  test('連番を組み立て、拡張子を小文字化する', () => {
    const dir = tmpDirWith(['a.png', 'b.JPG', 'c.gif'])
    const { plan } = buildRenamePlan({
      dir, files: ['a.png', 'b.JPG', 'c.gif'],
      prefix: '花_ひまわり', digits: 4, start: 10, step: 10
    })
    expect(plan.map(p => p.toName)).toEqual([
      '花_ひまわり_0010.png', '花_ひまわり_0020.jpg', '花_ひまわり_0030.gif'
    ])
    expect(plan.every(p => !p.collides)).toBe(true)
  })

  test('対象外ファイルとの衝突を検出する', () => {
    const dir = tmpDirWith(['a.png', 'b.png', '花_ひまわり_0020.png'])
    const { plan } = buildRenamePlan({
      dir, files: ['a.png', 'b.png'],
      prefix: '花_ひまわり', digits: 4, start: 10, step: 10
    })
    expect(plan[0].collides).toBe(false)
    expect(plan[1].collides).toBe(true)
    expect(plan[1].reason).toBe('exists')
  })

  test('リネームで空く名前は衝突扱いにしない', () => {
    // 花_ひまわり_0010.png 自身が対象に含まれる → 衝突ではない
    const dir = tmpDirWith(['花_ひまわり_0010.png', 'b.png'])
    const { plan } = buildRenamePlan({
      dir, files: ['花_ひまわり_0010.png', 'b.png'],
      prefix: '花_ひまわり', digits: 4, start: 10, step: 10
    })
    expect(plan.every(p => !p.collides)).toBe(true)
  })

  test('ケース違いの既存ファイルも衝突として検出する', () => {
    // 拡張子が小文字化されるため .PNG の既存ファイルと衝突しうる。
    // ケース非依存のファイルシステムでは同一ファイルを指す。
    const dir = tmpDirWith(['a.png', '花_ひまわり_0010.PNG'])
    const { plan } = buildRenamePlan({
      dir, files: ['a.png'],
      prefix: '花_ひまわり', digits: 4, start: 10, step: 10
    })
    expect(plan[0].toName).toBe('花_ひまわり_0010.png')
    expect(plan[0].collides).toBe(true)
  })

  test('計画内で同名になる場合も衝突として検出する', () => {
    const dir = tmpDirWith(['a.png', 'b.png'])
    const { plan } = buildRenamePlan({
      dir, files: ['a.png', 'b.png'],
      prefix: 'x', digits: 4, start: 10, step: 0   // step 0 は 1 に補正される
    })
    expect(plan.map(p => p.toName)).toEqual(['x_0010.png', 'x_0011.png'])
    expect(plan.every(p => !p.collides)).toBe(true)
  })

  test('開始番号を変えれば衝突を回避できる', () => {
    const dir = tmpDirWith(['a.png', '花_ひまわり_0010.png'])
    const collide = buildRenamePlan({
      dir, files: ['a.png'], prefix: '花_ひまわり', digits: 4, start: 10, step: 10
    })
    expect(collide.plan[0].collides).toBe(true)

    const avoided = buildRenamePlan({
      dir, files: ['a.png'], prefix: '花_ひまわり', digits: 4, start: 20, step: 10
    })
    expect(avoided.plan[0].collides).toBe(false)
  })
})

test.describe('clampInt', () => {
  test('範囲外と不正値を丸める', () => {
    expect(clampInt('4', 4, 1, 10)).toBe(4)
    expect(clampInt('99', 4, 1, 10)).toBe(10)
    expect(clampInt('0', 4, 1, 10)).toBe(1)
    expect(clampInt('', 4, 1, 10)).toBe(4)
    expect(clampInt('abc', 4, 1, 10)).toBe(4)
  })
})

test.describe('applyRenamePlan', () => {
  test('計画どおりにリネームし、対象外は変更しない', () => {
    const dir = tmpDirWith(['a.png', 'b.png', 'keep.png'])
    const { plan } = buildRenamePlan({
      dir, files: ['a.png', 'b.png'], prefix: 'x', digits: 4, start: 10, step: 10
    })
    const renamed = applyRenamePlan(plan)

    expect(renamed).toEqual([
      { from: 'a.png', to: 'x_0010.png' },
      { from: 'b.png', to: 'x_0020.png' }
    ])
    expect(ls(dir)).toEqual(['keep.png', 'x_0010.png', 'x_0020.png'])
    expect(fs.readFileSync(path.join(dir, 'x_0010.png'), 'utf8')).toBe('a.png')
  })

  test('名前が入れ替わる計画でも壊れない', () => {
    const dir = tmpDirWith(['x_0020.png', 'x_0010.png'])
    const { plan } = buildRenamePlan({
      dir, files: ['x_0020.png', 'x_0010.png'], prefix: 'x', digits: 4, start: 10, step: 10
    })
    applyRenamePlan(plan)

    expect(ls(dir)).toEqual(['x_0010.png', 'x_0020.png'])
    // 元 x_0020.png が x_0010.png になっている
    expect(fs.readFileSync(path.join(dir, 'x_0010.png'), 'utf8')).toBe('x_0020.png')
    expect(fs.readFileSync(path.join(dir, 'x_0020.png'), 'utf8')).toBe('x_0010.png')
  })

  test('第2段階の失敗でロールバックされ、__tmp__ が残らない', () => {
    const dir = tmpDirWith(['a.png', 'b.png', 'c.png'])
    const { plan } = buildRenamePlan({
      dir, files: ['a.png', 'b.png', 'c.png'], prefix: 'x', digits: 4, start: 10, step: 10
    })

    // 3件目の本リネームだけ失敗させる
    let moves = 0
    const failing = {
      renameSync(from, to) {
        moves++
        if (moves === 6) throw new Error('injected failure')
        return fs.renameSync(from, to)
      }
    }

    expect(() => applyRenamePlan(plan, failing)).toThrow(/元に戻しました/)
    expect(ls(dir)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(fs.readdirSync(dir).filter(f => f.includes('__tmp__'))).toEqual([])
    expect(fs.readFileSync(path.join(dir, 'a.png'), 'utf8')).toBe('a.png')
  })

  test('第1段階の失敗でもロールバックされる', () => {
    const dir = tmpDirWith(['a.png', 'b.png', 'c.png'])
    const { plan } = buildRenamePlan({
      dir, files: ['a.png', 'b.png', 'c.png'], prefix: 'x', digits: 4, start: 10, step: 10
    })

    let moves = 0
    const failing = {
      renameSync(from, to) {
        moves++
        if (moves === 3) throw new Error('injected failure')
        return fs.renameSync(from, to)
      }
    }

    expect(() => applyRenamePlan(plan, failing)).toThrow(/元に戻しました/)
    expect(ls(dir)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(fs.readdirSync(dir).filter(f => f.includes('__tmp__'))).toEqual([])
  })
})
