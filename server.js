const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3456

app.use(express.json())
app.use(express.static('public'))

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']

// 作成日時・更新日時・サイズを返す。
// birthtime を取得できないファイルシステム（古い ext4 など）では 0 や
// mtime より後の値が返るため、その場合は mtime にフォールバックする。
function fileTimes(filePath) {
  try {
    const st = fs.statSync(filePath)
    const usable = st.birthtimeMs > 0 && st.birthtimeMs <= st.mtimeMs
    const birthtime = usable ? st.birthtime : st.mtime
    return {
      birthtime: birthtime.toISOString(),
      mtime: st.mtime.toISOString(),
      size: st.size
    }
  } catch {
    // 一覧取得後に削除された場合など。一覧からは落とさず日時のみ null にする
    return { birthtime: null, mtime: null, size: null }
  }
}

app.get('/api/images', (req, res) => {
  const dir = req.query.dir
  if (!dir) return res.status(400).json({ error: 'dir is required' })

  const absDir = path.resolve(dir)
  if (!fs.existsSync(absDir)) return res.status(404).json({ error: 'Directory not found' })

  const files = fs.readdirSync(absDir)
    .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
    .sort()
    .map(f => {
      const filePath = path.join(absDir, f)
      return { name: f, path: filePath, ...fileTimes(filePath) }
    })

  res.json({ dir: absDir, files })
})

app.get('/api/thumbnail', (req, res) => {
  const filePath = req.query.path
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not found')
  res.sendFile(filePath)
})

// リネーム計画を組み立てる。実行はしない。
//
// 衝突判定はファイル名を小文字化して比較する。macOS の APFS など
// ケース非依存のファイルシステムでは A.PNG と a.png が同一のファイルを
// 指すため、単純な文字列比較では取りこぼす。
function buildRenamePlan({ dir, files, prefix, digits, start, step }) {
  const absDir = path.resolve(dir)
  const d = clampInt(digits, 4, 1, 10)
  const s = clampInt(start, 1, 0, Number.MAX_SAFE_INTEGER)
  const sk = clampInt(step, 1, 1, Number.MAX_SAFE_INTEGER)   // 0 だと全件同名になる

  const plan = files.map((file, i) => {
    const ext = path.extname(file).toLowerCase()
    const num = String(s + i * sk).padStart(d, '0')
    const toName = `${prefix}_${num}${ext}`
    return {
      fromName: file,
      toName,
      from: path.join(absDir, file),
      to: path.join(absDir, toName)
    }
  })

  // この計画でリネームされて「いなくなる」名前は衝突扱いにしない
  const vacating = new Set(plan.map(p => p.fromName.toLowerCase()))
  const existing = new Set(
    fs.existsSync(absDir) ? fs.readdirSync(absDir).map(f => f.toLowerCase()) : []
  )

  // 計画内で同じ名前に衝突していないか（桁あふれ等）
  const seen = new Map()
  plan.forEach(p => {
    const key = p.toName.toLowerCase()
    seen.set(key, (seen.get(key) || 0) + 1)
  })

  for (const p of plan) {
    const key = p.toName.toLowerCase()
    const duplicated = seen.get(key) > 1
    const takenByOutsider = existing.has(key) && !vacating.has(key)
    p.collides = Boolean(duplicated || takenByOutsider)
    p.reason = duplicated ? 'duplicate' : (takenByOutsider ? 'exists' : null)
  }

  return { dir: absDir, plan }
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

// 計画を適用する。途中で失敗したら元の状態へ戻す。
//
// from -> .__tmp__ -> to の2段階。1段階目で直接 to へ動かすと、
// 計画内で名前が入れ替わる場合に上書きが起きるため。
function applyRenamePlan(plan, fsImpl = fs) {
  const staged = []      // 1段階目を終えたもの
  const completed = []   // 2段階目まで終えたもの

  try {
    for (const p of plan) {
      const temp = `${p.from}.__tmp__`
      fsImpl.renameSync(p.from, temp)
      staged.push({ ...p, temp })
    }
    for (const p of staged) {
      fsImpl.renameSync(p.temp, p.to)
      completed.push(p)
    }
  } catch (err) {
    // 完了済みを戻してから、退避中のものを戻す
    for (const p of completed.reverse()) {
      try { fsImpl.renameSync(p.to, p.from) } catch { /* 最善努力 */ }
    }
    for (const p of staged) {
      if (completed.includes(p)) continue
      try { fsImpl.renameSync(p.temp, p.from) } catch { /* 最善努力 */ }
    }
    const e = new Error(`リネームに失敗したため元に戻しました: ${err.message}`)
    e.rolledBack = true
    throw e
  }

  return completed.map(p => ({ from: p.fromName, to: p.toName }))
}

app.post('/api/rename/plan', (req, res) => {
  const { dir, files, prefix } = req.body
  if (!dir || !Array.isArray(files) || !prefix) {
    return res.status(400).json({ error: 'dir, files, prefix は必須です' })
  }
  if (!fs.existsSync(path.resolve(dir))) {
    return res.status(404).json({ error: 'Directory not found' })
  }

  const { dir: absDir, plan } = buildRenamePlan(req.body)
  res.json({
    dir: absDir,
    plan: plan.map(p => ({ from: p.fromName, to: p.toName, collides: p.collides, reason: p.reason })),
    collisions: plan.filter(p => p.collides).length
  })
})

app.post('/api/rename', (req, res) => {
  const { dir, files, prefix } = req.body
  if (!dir || !Array.isArray(files) || !prefix) {
    return res.status(400).json({ error: 'dir, files, prefix は必須です' })
  }
  if (!fs.existsSync(path.resolve(dir))) {
    return res.status(404).json({ error: 'Directory not found' })
  }

  // クライアントの計算を信用せず、サーバー側で組み直す
  const { plan } = buildRenamePlan(req.body)

  const collisions = plan.filter(p => p.collides)
  if (collisions.length > 0) {
    return res.status(409).json({
      error: `${collisions.length} 件が既存のファイルと衝突します`,
      collisions: collisions.map(p => ({ from: p.fromName, to: p.toName, reason: p.reason }))
    })
  }

  const missing = plan.filter(p => !fs.existsSync(p.from))
  if (missing.length > 0) {
    return res.status(409).json({
      error: `対象のファイルが見つかりません: ${missing[0].fromName}`
    })
  }

  try {
    const renamed = applyRenamePlan(plan)
    res.json({ renamed })
  } catch (err) {
    res.status(500).json({ error: err.message, rolledBack: Boolean(err.rolledBack) })
  }
})

module.exports = { buildRenamePlan, applyRenamePlan, clampInt }

// テストから require したときにサーバーを起動しないようにする
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`cyk-media-manager running at http://localhost:${PORT}`)
  })
}
