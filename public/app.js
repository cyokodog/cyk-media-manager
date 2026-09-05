const HISTORY_KEY = 'cyk-media-manager:history'
const HISTORY_MAX = 8

let currentDir = ''
let files = []

const dirInput = document.getElementById('dirInput')
const dirField = document.getElementById('dirField')
const loadBtn = document.getElementById('loadBtn')
const historyBtn = document.getElementById('historyBtn')
const historyMenu = document.getElementById('historyMenu')
const historyList = document.getElementById('historyList')
const count = document.getElementById('count')
const errorMsg = document.getElementById('errorMsg')
const errorText = document.getElementById('errorText')

const leftBody = document.getElementById('leftBody')
const rightBody = document.getElementById('rightBody')

loadBtn.addEventListener('click', loadImages)
dirInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadImages() })
dirInput.addEventListener('input', clearError)

historyBtn.addEventListener('click', e => {
  e.stopPropagation()
  historyMenu.hidden ? openHistory() : closeHistory()
})
document.addEventListener('click', e => {
  if (!historyMenu.hidden && !historyMenu.contains(e.target)) closeHistory()
})
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !historyMenu.hidden) closeHistory()
})

restoreLastDir()

// ---------- 読み込み ----------

async function loadImages() {
  const dir = dirInput.value.trim()
  if (!dir) return

  clearError()
  setCount('読み込み中...')
  loadBtn.disabled = true

  try {
    const res = await fetch(`/api/images?dir=${encodeURIComponent(dir)}`)
    const data = await res.json()
    if (!res.ok) return showError(data.error || '読み込みに失敗しました')

    currentDir = data.dir
    files = data.files
    dirInput.value = data.dir

    renderColumn(leftBody, files, { showDate: true })
    renderColumn(rightBody, files, { showDate: false })
    setCount(`${files.length} 件`)
    pushHistory(data.dir)
  } catch {
    showError('読み込みに失敗しました')
  } finally {
    loadBtn.disabled = false
  }
}

// 左右列の仮表示。並び順の制御は #4、中央列への D&D は #4 / #5 で実装する
// 作成日は左列のみ表示する（デザイン #7 に合わせる）
function renderColumn(container, list, { showDate } = { showDate: false }) {
  container.innerHTML = ''

  if (list.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.innerHTML = '<div class="sub">画像ファイルがありません</div>'
    container.appendChild(empty)
    return
  }

  const grid = document.createElement('div')
  grid.className = 'grid'

  list.forEach(f => {
    const thumb = document.createElement('div')
    thumb.className = 'thumb'
    thumb.dataset.name = f.name

    const img = document.createElement('img')
    img.src = `/api/thumbnail?path=${encodeURIComponent(f.path)}`
    img.loading = 'lazy'
    img.alt = ''

    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = f.name
    name.title = f.name

    thumb.append(img, name)

    if (showDate) {
      const date = document.createElement('div')
      date.className = 'date'
      date.textContent = formatDate(f.birthtime)
      thumb.appendChild(date)
    }
    grid.appendChild(thumb)
  })

  container.appendChild(grid)
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- ヘッダーの表示 ----------

function setCount(text) {
  count.textContent = text
}

function showError(message) {
  errorText.textContent = message
  errorMsg.hidden = false
  dirField.classList.add('error')
  setCount('')
  clearColumns()
}

function clearError() {
  errorMsg.hidden = true
  dirField.classList.remove('error')
}

function clearColumns() {
  currentDir = ''
  files = []
  for (const [container, label] of [[leftBody, '作成日順'], [rightBody, '名前順']]) {
    container.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.innerHTML = `<div class="sub">フォルダを読み込むと<br>${label}に表示されます</div>`
    container.appendChild(empty)
  }
}

// ---------- 履歴 ----------

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter(p => typeof p === 'string') : []
  } catch {
    return []
  }
}

function pushHistory(dir) {
  try {
    const list = [dir, ...readHistory().filter(p => p !== dir)].slice(0, HISTORY_MAX)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    // プライベートモード等で書き込めない場合は履歴を諦める
  }
}

function restoreLastDir() {
  const [last] = readHistory()
  if (last) dirInput.value = last
}

function openHistory() {
  const list = readHistory()
  historyList.innerHTML = ''

  if (list.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'history-empty'
    empty.textContent = '履歴はまだありません'
    historyList.appendChild(empty)
  } else {
    list.forEach(dir => {
      const item = document.createElement('div')
      item.className = 'history-item'
      item.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'

      const lines = document.createElement('div')
      lines.className = 'lines'

      const base = document.createElement('div')
      base.className = 'base'
      base.textContent = dir.split('/').filter(Boolean).pop() || dir

      const full = document.createElement('div')
      full.className = 'full'
      full.textContent = dir

      lines.append(base, full)
      item.appendChild(lines)
      item.addEventListener('click', () => {
        dirInput.value = dir
        closeHistory()
        loadImages()
      })
      historyList.appendChild(item)
    })
  }

  historyMenu.hidden = false
}

function closeHistory() {
  historyMenu.hidden = true
}
