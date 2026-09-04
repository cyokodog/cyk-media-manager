let currentDir = ''
let sortable = null
let selectedItems = new Set()

const grid = document.getElementById('grid')
const status = document.getElementById('status')
const renameBtn = document.getElementById('renameBtn')

document.getElementById('loadBtn').addEventListener('click', loadImages)
document.getElementById('dirInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadImages() })
renameBtn.addEventListener('click', renameFiles)

async function loadImages() {
  const dir = document.getElementById('dirInput').value.trim()
  if (!dir) return

  setStatus('読み込み中...')
  try {
    const res = await fetch(`/api/images?dir=${encodeURIComponent(dir)}`)
    const data = await res.json()
    if (!res.ok) return setStatus(`エラー: ${data.error}`)

    currentDir = data.dir
    renderGrid(data.files)
    setStatus(`${data.files.length} 件`)
    renameBtn.disabled = data.files.length === 0
  } catch (e) {
    setStatus('読み込み失敗')
  }
}

function renderGrid(files) {
  grid.innerHTML = ''
  selectedItems.clear()
  if (sortable) { sortable.destroy(); sortable = null }

  files.forEach(f => {
    const div = document.createElement('div')
    div.className = 'thumb'
    div.dataset.name = f.name

    const img = document.createElement('img')
    img.src = `/api/thumbnail?path=${encodeURIComponent(f.path)}`
    img.loading = 'lazy'

    const label = document.createElement('div')
    label.className = 'label'
    label.textContent = f.name

    div.addEventListener('click', e => toggleSelect(div, e))

    div.appendChild(img)
    div.appendChild(label)
    grid.appendChild(div)
  })

  sortable = Sortable.create(grid, {
    animation: 150,
    filter: '.sortable-selected',
    onStart(evt) {
      // ドラッグ開始時、選択済みアイテムがあれば一緒に移動
      if (selectedItems.size > 0 && !selectedItems.has(evt.item)) {
        selectedItems.clear()
        evt.item.classList.remove('sortable-selected')
      }
    },
    onEnd(evt) {
      if (selectedItems.size === 0) return

      // ドラッグしたアイテムの新しい位置に選択済みアイテムを続けて挿入
      const anchor = evt.item
      const allThumbs = [...grid.querySelectorAll('.thumb')]
      const anchorIndex = allThumbs.indexOf(anchor)

      // 選択済みアイテム（ドラッグしたもの除く）を anchorの後ろに移動
      ;[...selectedItems].forEach((el, i) => {
        if (el === anchor) return
        const ref = allThumbs[anchorIndex + i + 1] || null
        grid.insertBefore(el, ref ? ref.nextSibling : null)
      })
    }
  })
}

function toggleSelect(el, e) {
  if (!e.metaKey && !e.ctrlKey) {
    // 修飾キーなし → 他の選択をクリア
    selectedItems.forEach(item => item.classList.remove('sortable-selected'))
    selectedItems.clear()
  }
  if (selectedItems.has(el)) {
    el.classList.remove('sortable-selected')
    selectedItems.delete(el)
  } else {
    el.classList.add('sortable-selected')
    selectedItems.add(el)
  }
}

async function renameFiles() {
  const prefix = document.getElementById('prefixInput').value.trim()
  if (!prefix) return setStatus('プレフィックスを入力してください')

  const files = [...grid.querySelectorAll('.thumb')].map(el => el.dataset.name)
  const digits = document.getElementById('digitsInput').value
  const start = document.getElementById('startInput').value
  const step = document.getElementById('stepInput').value

  setStatus('リネーム中...')
  renameBtn.disabled = true

  try {
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: currentDir, files, prefix, digits, start, step })
    })
    const data = await res.json()
    if (!res.ok) return setStatus(`エラー: ${data.error}`)

    setStatus(`完了: ${data.renamed.length} 件リネーム`)
    await loadImages()
  } catch (e) {
    setStatus('リネーム失敗')
    renameBtn.disabled = false
  }
}

function setStatus(msg) {
  status.textContent = msg
}
