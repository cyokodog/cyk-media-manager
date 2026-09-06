const HISTORY_KEY = 'cyk-media-manager:history'
const HISTORY_MAX = 8
const DND_MIME = 'application/x-cyk-media'
const DND_REMOVE_MIME = 'application/x-cyk-media-remove'

// ---------- 状態 ----------
//
// 単一の情報源はこのオブジェクトで、DOM はその描画結果として扱う。
// 再描画で要素が入れ替わるため、選択も追加済みも**ファイル名をキー**にする。
//
// targetOrder は中央列の並び。#5 が並べ替え・削除の UI を足すが、
// 状態の持ち方と removeFromTarget() はここで確定させている。

const state = {
  dir: '',
  files: [],                       // API の返却をそのまま保持（順序は加工しない）
  targetOrder: [],                 // 中央列に入っているファイル名（順序どおり）
  sort: { left: 'asc', right: 'asc' },
  selected: { left: new Set(), right: new Set() },
  lastClicked: { left: null, right: null }   // shift 範囲選択の起点
}

const collator = new Intl.Collator(undefined, { numeric: true })

const dirInput = document.getElementById('dirInput')
const dirField = document.getElementById('dirField')
const loadBtn = document.getElementById('loadBtn')
const historyBtn = document.getElementById('historyBtn')
const historyMenu = document.getElementById('historyMenu')
const historyList = document.getElementById('historyList')
const count = document.getElementById('count')
const errorMsg = document.getElementById('errorMsg')
const errorText = document.getElementById('errorText')

const centerCol = document.querySelector('.col-center')
const centerBody = document.getElementById('centerBody')
const centerCount = document.getElementById('centerCount')

const columns = {
  left: { body: document.getElementById('leftBody'), toggle: document.getElementById('leftSort'), showDate: true, label: '作成日順' },
  right: { body: document.getElementById('rightBody'), toggle: document.getElementById('rightSort'), showDate: false, label: '名前順' }
}

loadBtn.addEventListener('click', loadImages)
dirInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadImages() })
dirInput.addEventListener('input', clearError)

for (const side of ['left', 'right']) {
  columns[side].toggle.addEventListener('click', () => {
    state.sort[side] = state.sort[side] === 'asc' ? 'desc' : 'asc'
    syncSortToggle(side)
    renderColumn(side)
  })
  syncSortToggle(side)
}

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

setupCenterDropZone()
setupSourceDropZones()
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

    state.dir = data.dir
    state.files = data.files
    state.targetOrder = []
    state.selected.left.clear()
    state.selected.right.clear()
    state.lastClicked.left = null
    state.lastClicked.right = null

    dirInput.value = data.dir
    renderAll()
    setCount(`${state.files.length} 件`)
    pushHistory(data.dir)
  } catch {
    showError('読み込みに失敗しました')
  } finally {
    loadBtn.disabled = false
  }
}

// ---------- 並べ替え ----------

// 作成日順。birthtime は null になりうる（#2 のフォールバック）ため明示的に
// 末尾へ送り、同値のときは名前でタイブレークして描画を安定させる。
function sortByDate(list, dir) {
  const sign = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const ta = a.birthtime ? Date.parse(a.birthtime) : NaN
    const tb = b.birthtime ? Date.parse(b.birthtime) : NaN
    const na = Number.isNaN(ta)
    const nb = Number.isNaN(tb)
    if (na && nb) return collator.compare(a.name, b.name)
    if (na) return 1
    if (nb) return -1
    if (ta !== tb) return (ta - tb) * sign
    return collator.compare(a.name, b.name)
  })
}

// 名前順。自然順ソート（img2 が img10 より前）。
// sensitivity は既定のまま（'base' にすると大文字小文字が同値になり順序が不定になる）。
function sortByName(list, dir) {
  const sign = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => collator.compare(a.name, b.name) * sign)
}

function sortedFor(side) {
  const dir = state.sort[side]
  return side === 'left' ? sortByDate(state.files, dir) : sortByName(state.files, dir)
}

function syncSortToggle(side) {
  const { toggle } = columns[side]
  const dir = state.sort[side]
  toggle.dataset.dir = dir
  toggle.querySelector('.sort-label').textContent = dir === 'asc' ? '昇順' : '降順'
}

// ---------- 描画 ----------

function renderAll() {
  renderColumn('left')
  renderColumn('right')
  renderCenter()
}

function renderColumn(side) {
  const { body, showDate, label } = columns[side]
  body.innerHTML = ''

  if (state.files.length === 0) {
    body.appendChild(emptyBlock(
      state.dir ? '画像ファイルがありません' : `フォルダを読み込むと<br>${label}に表示されます`
    ))
    return
  }

  const grid = document.createElement('div')
  grid.className = 'grid'

  sortedFor(side).forEach(f => {
    const added = state.targetOrder.includes(f.name)
    const thumb = document.createElement('div')
    thumb.className = 'thumb'
    thumb.dataset.name = f.name
    if (added) thumb.classList.add('added')
    if (state.selected[side].has(f.name)) thumb.classList.add('selected')

    // 追加済みは再投入できないのでドラッグ不可にする
    thumb.draggable = !added

    const img = document.createElement('img')
    img.src = `/api/thumbnail?path=${encodeURIComponent(f.path)}`
    img.loading = 'lazy'
    img.alt = ''
    thumb.appendChild(img)

    if (added) {
      const badge = document.createElement('div')
      badge.className = 'added-badge'
      badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4a7cf7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>追加済み</span>'
      thumb.appendChild(badge)
    }

    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = f.name
    name.title = f.name
    thumb.appendChild(name)

    if (showDate) {
      const date = document.createElement('div')
      date.className = 'date'
      date.textContent = formatDate(f.birthtime)
      thumb.appendChild(date)
    }

    thumb.addEventListener('click', e => handleThumbClick(side, f.name, e))
    thumb.addEventListener('dragstart', e => handleDragStart(side, f.name, e))
    thumb.addEventListener('dragend', () => {
      body.querySelectorAll('.thumb.dragging').forEach(el => el.classList.remove('dragging'))
    })

    grid.appendChild(thumb)
  })

  body.appendChild(grid)
}

// 中央列は #5 が本実装する。ここでは投入結果が見える最小限の描画に留める。
function renderCenter() {
  centerCount.textContent = `${state.targetOrder.length} 件`
  centerBody.innerHTML = ''

  if (state.targetOrder.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.innerHTML = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#3d4658" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="4 3"/><path d="M12 9v6M9 12h6"/></svg>'
    const text = document.createElement('div')
    text.innerHTML = '<div class="lead">リネームするファイルをここへ</div><div class="sub" style="margin-top: 5px;">左右の列からドラッグして追加します<br>並べた順に連番が振られます</div>'
    empty.appendChild(text)
    centerBody.appendChild(empty)
    return
  }

  const grid = document.createElement('div')
  grid.className = 'grid'

  state.targetOrder.forEach(name => {
    const f = state.files.find(x => x.name === name)
    if (!f) return

    const thumb = document.createElement('div')
    thumb.className = 'thumb'
    thumb.dataset.name = name

    const img = document.createElement('img')
    img.src = `/api/thumbnail?path=${encodeURIComponent(f.path)}`
    img.loading = 'lazy'
    img.alt = ''

    const label = document.createElement('div')
    label.className = 'name'
    label.textContent = name
    label.title = name

    // 左右列へドラッグして戻すと中央列から外れる。
    // 中央列内の並べ替え・×ボタン・全クリアの UI は #5 が実装する。
    thumb.draggable = true
    thumb.addEventListener('dragstart', e => {
      e.dataTransfer.setData(DND_REMOVE_MIME, JSON.stringify([name]))
      e.dataTransfer.effectAllowed = 'move'
      thumb.classList.add('dragging')
    })
    thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'))

    thumb.append(img, label)
    grid.appendChild(thumb)
  })

  centerBody.appendChild(grid)
}

function emptyBlock(html) {
  const el = document.createElement('div')
  el.className = 'empty'
  el.innerHTML = `<div class="sub">${html}</div>`
  return el
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- 選択 ----------

function handleThumbClick(side, name, e) {
  if (state.targetOrder.includes(name)) return   // 追加済みは選択できない

  const sel = state.selected[side]
  const visible = sortedFor(side).map(f => f.name).filter(n => !state.targetOrder.includes(n))

  if (e.shiftKey && state.lastClicked[side]) {
    const from = visible.indexOf(state.lastClicked[side])
    const to = visible.indexOf(name)
    if (from !== -1 && to !== -1) {
      sel.clear()
      const [lo, hi] = from <= to ? [from, to] : [to, from]
      for (let i = lo; i <= hi; i++) sel.add(visible[i])
    }
  } else if (e.metaKey || e.ctrlKey) {
    sel.has(name) ? sel.delete(name) : sel.add(name)
    state.lastClicked[side] = name
  } else {
    sel.clear()
    sel.add(name)
    state.lastClicked[side] = name
  }

  // 片方の列で選択したらもう片方は解除する（投入元を1つに保つ）
  const other = side === 'left' ? 'right' : 'left'
  state.selected[other].clear()

  renderColumn('left')
  renderColumn('right')
}

// ---------- D&D ----------
//
// SortableJS の MultiDrag はこの CDN ビルドに含まれておらず
// （Sortable.MultiDrag is not a constructor）、pull: 'clone' との併用もできない。
// 左右列は読み取り専用で DOM を動かす必要がないため、
// HTML5 のネイティブ D&D でファイル名の配列を運ぶ。

function handleDragStart(side, name, e) {
  const sel = state.selected[side]

  // 選択外をドラッグし始めたら、その1件だけを対象にする
  let names
  if (sel.has(name)) {
    names = sortedFor(side).map(f => f.name).filter(n => sel.has(n))
  } else {
    sel.clear()
    sel.add(name)
    state.lastClicked[side] = name
    names = [name]
    renderColumn(side)
  }
  names = names.filter(n => !state.targetOrder.includes(n))

  if (names.length === 0) { e.preventDefault(); return }

  e.dataTransfer.setData(DND_MIME, JSON.stringify(names))
  e.dataTransfer.setData('text/plain', names.join('\n'))
  e.dataTransfer.effectAllowed = 'copy'

  columns[side].body.querySelectorAll('.thumb').forEach(el => {
    if (names.includes(el.dataset.name)) el.classList.add('dragging')
  })
}

// 左右列へ落とすと中央列から外れる（追加済み表示が解除される）
function setupSourceDropZones() {
  for (const side of ['left', 'right']) {
    const col = columns[side].body.closest('.col')

    col.addEventListener('dragover', e => {
      if (![...(e.dataTransfer?.types || [])].includes(DND_REMOVE_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    })

    col.addEventListener('drop', e => {
      if (![...(e.dataTransfer?.types || [])].includes(DND_REMOVE_MIME)) return
      e.preventDefault()
      let names = []
      try {
        names = JSON.parse(e.dataTransfer.getData(DND_REMOVE_MIME) || '[]')
      } catch {
        return
      }
      if (Array.isArray(names) && names.length) removeFromTarget(names)
    })
  }
}

function setupCenterDropZone() {
  let depth = 0

  centerCol.addEventListener('dragenter', e => {
    if (!hasPayload(e)) return
    e.preventDefault()
    depth++
    centerCol.classList.add('drop-active')
  })

  centerCol.addEventListener('dragover', e => {
    if (!hasPayload(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  })

  centerCol.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1)
    if (depth === 0) centerCol.classList.remove('drop-active')
  })

  centerCol.addEventListener('drop', e => {
    e.preventDefault()
    depth = 0
    centerCol.classList.remove('drop-active')

    let names = []
    try {
      names = JSON.parse(e.dataTransfer.getData(DND_MIME) || '[]')
    } catch {
      return
    }
    if (!Array.isArray(names) || names.length === 0) return

    addToTarget(names)
  })
}

function hasPayload(e) {
  return [...(e.dataTransfer?.types || [])].includes(DND_MIME)
}

// ---------- 中央列の状態操作（#5 はこれを使う） ----------

function addToTarget(names) {
  const known = new Set(state.files.map(f => f.name))
  const incoming = names.filter(n => known.has(n) && !state.targetOrder.includes(n))
  if (incoming.length === 0) return

  state.targetOrder.push(...incoming)
  state.selected.left.clear()
  state.selected.right.clear()
  renderAll()
}

function removeFromTarget(names) {
  const drop = new Set(Array.isArray(names) ? names : [names])
  const before = state.targetOrder.length
  state.targetOrder = state.targetOrder.filter(n => !drop.has(n))
  if (state.targetOrder.length !== before) renderAll()
}

function clearTarget() {
  if (state.targetOrder.length === 0) return
  state.targetOrder = []
  renderAll()
}

// #5 および E2E から使う
window.__cyk = { state, addToTarget, removeFromTarget, clearTarget, renderAll }

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
  state.dir = ''
  state.files = []
  state.targetOrder = []
  state.selected.left.clear()
  state.selected.right.clear()
  renderAll()
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
