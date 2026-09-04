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

app.post('/api/rename', (req, res) => {
  const { dir, files, prefix, digits, start, step } = req.body
  if (!dir || !files || !prefix) return res.status(400).json({ error: 'Missing required fields' })

  const absDir = path.resolve(dir)
  const d = parseInt(digits) || 3
  const s = parseInt(start) || 1
  const sk = parseInt(step) || 1

  const plan = files.map((file, i) => {
    const ext = path.extname(file).toLowerCase()
    const num = String(s + i * sk).padStart(d, '0')
    return { from: path.join(absDir, file), to: path.join(absDir, `${prefix}_${num}${ext}`) }
  })

  // 衝突チェック
  for (const { to } of plan) {
    if (fs.existsSync(to) && !plan.find(p => p.from === to)) {
      return res.status(409).json({ error: `File already exists: ${path.basename(to)}` })
    }
  }

  // 一時リネーム → 本リネーム（上書き衝突回避）
  const tmp = plan.map(p => ({ ...p, temp: p.from + '.__tmp__' }))
  tmp.forEach(p => fs.renameSync(p.from, p.temp))
  tmp.forEach(p => fs.renameSync(p.temp, p.to))

  res.json({ renamed: plan.map(p => ({ from: path.basename(p.from), to: path.basename(p.to) })) })
})

app.listen(PORT, () => {
  console.log(`cyk-media-manager running at http://localhost:${PORT}`)
})
