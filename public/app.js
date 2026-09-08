const HISTORY_KEY = 'cyk-media-manager:history'
const HISTORY_MAX = 8
const DND_MIME = 'application/x-cyk-media'
const DND_REMOVE_MIME = 'application/x-cyk-media-remove'
const DND_MOVE_MIME = 'application/x-cyk-media-move'

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
  selected: { left: new Set(), right: new Set(), center: new Set() },
  lastClicked: { left: null, right: null, center: null }   // shift 範囲選択の起点
}

// 連番の設定。フッターの入力と連動する
const seq = { digits: 4, start: 10, step: 10 }

function seqLabel(index) {
  return String(seq.start + index * seq.step).padStart(seq.digits, '0')
}

// サーバー側の clampInt と同じ丸め方をする（プレビューと実行を一致させるため）
function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(Math.max(n, min), max)
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
const clearBtn = document.getElementById('clearBtn')

const prefixInput = document.getElementById('prefixInput')
const digitsInput = document.getElementById('digitsInput')
const startInput = document.getElementById('startInput')
const stepInput = document.getElementById('stepInput')
const targetCount = document.getElementById('targetCount')
const sampleName = document.getElementById('sampleName')
const previewBtn = document.getElementById('previewBtn')
const renameBtn = document.getElementById('renameBtn')

const modalBackdrop = document.getElementById('modalBackdrop')
const modal = document.getElementById('modal')
const modalSub = document.getElementById('modalSub')
const modalDir = document.getElementById('modalDir')
const modalWarning = document.getElementById('modalWarning')
const modalWarnTitle = document.getElementById('modalWarnTitle')
const modalList = document.getElementById('modalList')
const modalStart = document.getElementById('modalStart')
const modalStartHint = document.getElementById('modalStartHint')
const modalApply = document.getElementById('modalApply')

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

clearBtn.addEventListener('click', () => clearTarget())

for (const input of [digitsInput, startInput, stepInput]) {
  input.addEventListener('input', () => { readSeqInputs(); renderCenter(); syncFooter() })
}
prefixInput.addEventListener('input', syncFooter)
previewBtn.addEventListener('click', openPreview)
renameBtn.addEventListener('click', openPreview)

document.getElementById('modalClose').addEventListener('click', closeModal)
document.getElementById('modalCancel').addEventListener('click', closeModal)
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal() })
modalApply.addEventListener('click', applyRename)
modalStart.addEventListener('input', () => {
  startInput.value = modalStart.value
  readSeqInputs()
  renderCenter()
  syncFooter()
  refreshPreview()
})
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalBackdrop.hidden) closeModal()
})

readSeqInputs()
syncFooter()

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
    state.selected.center.clear()
    state.lastClicked.left = null
    state.lastClicked.right = null
    state.lastClicked.center = null

    dirInput.value = data.dir
    renderAll()
    syncFooter()
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
    img.src = thumbUrl(f)
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

function renderCenter() {
  centerCount.textContent = `${state.targetOrder.length} 件`
  clearBtn.disabled = state.targetOrder.length === 0
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

  state.targetOrder.forEach((name, index) => {
    const f = state.files.find(x => x.name === name)
    if (!f) return

    const thumb = document.createElement('div')
    thumb.className = 'thumb'
    thumb.dataset.name = name
    thumb.draggable = true
    if (state.selected.center.has(name)) thumb.classList.add('selected')

    // 確定後の連番。並べ替えるたびに全件振り直す
    const badge = document.createElement('div')
    badge.className = 'seq-badge'
    badge.textContent = seqLabel(index)
    thumb.appendChild(badge)

    const remove = document.createElement('button')
    remove.className = 'remove-btn'
    remove.title = '中央列から外す'
    remove.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    remove.addEventListener('click', e => {
      e.stopPropagation()
      removeFromTarget([name])
    })
    thumb.appendChild(remove)

    const img = document.createElement('img')
    img.src = thumbUrl(f)
    img.loading = 'lazy'
    img.alt = ''

    const label = document.createElement('div')
    label.className = 'name'
    label.textContent = name
    label.title = name

    thumb.append(img, label)

    thumb.addEventListener('click', e => handleCenterClick(name, e))
    thumb.addEventListener('dragstart', e => handleCenterDragStart(name, e))
    thumb.addEventListener('dragend', () => {
      hideInsertLine()
      centerBody.querySelectorAll('.thumb.dragging').forEach(el => el.classList.remove('dragging'))
    })

    grid.appendChild(thumb)
  })

  centerBody.appendChild(grid)
}

// ---------- 中央列の選択 ----------

function handleCenterClick(name, e) {
  const sel = state.selected.center
  const order = state.targetOrder

  if (e.shiftKey && state.lastClicked.center) {
    const from = order.indexOf(state.lastClicked.center)
    const to = order.indexOf(name)
    if (from !== -1 && to !== -1) {
      sel.clear()
      const [lo, hi] = from <= to ? [from, to] : [to, from]
      for (let i = lo; i <= hi; i++) sel.add(order[i])
    }
  } else if (e.metaKey || e.ctrlKey) {
    sel.has(name) ? sel.delete(name) : sel.add(name)
    state.lastClicked.center = name
  } else {
    sel.clear()
    sel.add(name)
    state.lastClicked.center = name
  }

  // 中央列を触ったら左右列の選択は解除する
  state.selected.left.clear()
  state.selected.right.clear()
  renderAll()
}

// ---------- 中央列内の並べ替え ----------
//
// SortableJS は使わない（MultiDrag が CDN のビルドに無く、複数まとめての
// 並べ替えを自前で書く必要があるため）。左右列と同じネイティブ D&D に揃えた。

function handleCenterDragStart(name, e) {
  const sel = state.selected.center

  let names
  if (sel.has(name)) {
    names = state.targetOrder.filter(n => sel.has(n))
  } else {
    sel.clear()
    sel.add(name)
    state.lastClicked.center = name
    names = [name]
    renderCenter()
  }

  // 中央列内の並べ替えと、左右列へ戻す削除の両方を載せる
  e.dataTransfer.setData(DND_MOVE_MIME, JSON.stringify(names))
  e.dataTransfer.setData(DND_REMOVE_MIME, JSON.stringify(names))
  e.dataTransfer.effectAllowed = 'move'

  centerBody.querySelectorAll('.thumb').forEach(el => {
    if (names.includes(el.dataset.name)) el.classList.add('dragging')
  })
}

// ドロップ位置（何番目の前に入れるか）を、カーソルに最も近い境界から求める
function insertIndexAt(clientX, clientY) {
  const thumbs = [...centerBody.querySelectorAll('.thumb')]
  if (thumbs.length === 0) return 0

  let best = { index: thumbs.length, dist: Infinity }
  thumbs.forEach((el, i) => {
    const r = el.getBoundingClientRect()
    for (const [edge, index] of [[r.left, i], [r.right, i + 1]]) {
      const dx = clientX - edge
      const dy = clientY - (r.top + r.height / 2)
      const dist = Math.hypot(dx, dy)
      if (dist < best.dist) best = { index, dist }
    }
  })
  return best.index
}

let insertLine = null

function showInsertLine(index) {
  const thumbs = [...centerBody.querySelectorAll('.thumb')]
  if (thumbs.length === 0) return

  if (!insertLine) {
    insertLine = document.createElement('div')
    insertLine.className = 'insert-line'
    centerBody.appendChild(insertLine)
  }

  const bodyRect = centerBody.getBoundingClientRect()
  const at = index < thumbs.length ? thumbs[index] : thumbs[thumbs.length - 1]
  const r = at.getBoundingClientRect()
  const x = index < thumbs.length ? r.left : r.right

  insertLine.style.left = `${x - bodyRect.left + centerBody.scrollLeft - 1}px`
  insertLine.style.top = `${r.top - bodyRect.top + centerBody.scrollTop}px`
  insertLine.style.height = `${r.height}px`
}

function hideInsertLine() {
  if (insertLine) { insertLine.remove(); insertLine = null }
}

// 選択したものを index の位置へまとめて移動する
function reorderTarget(names, index) {
  const moving = new Set(names)
  if (moving.size === 0) return

  // 挿入位置より前にある移動対象の数だけ index を詰める
  const before = state.targetOrder.slice(0, index).filter(n => moving.has(n)).length
  const rest = state.targetOrder.filter(n => !moving.has(n))
  const ordered = state.targetOrder.filter(n => moving.has(n))

  rest.splice(index - before, 0, ...ordered)
  state.targetOrder = rest
  renderAll()
  syncFooter()
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

  const types = e => [...(e.dataTransfer?.types || [])]
  const isAdd = e => types(e).includes(DND_MIME)
  const isMove = e => types(e).includes(DND_MOVE_MIME)

  centerCol.addEventListener('dragenter', e => {
    if (!isAdd(e) && !isMove(e)) return
    e.preventDefault()
    depth++
    if (isAdd(e)) centerCol.classList.add('drop-active')
  })

  centerCol.addEventListener('dragover', e => {
    if (!isAdd(e) && !isMove(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = isMove(e) ? 'move' : 'copy'
    // 並べ替え中は挿入位置を示す
    if (isMove(e)) showInsertLine(insertIndexAt(e.clientX, e.clientY))
  })

  centerCol.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1)
    if (depth === 0) {
      centerCol.classList.remove('drop-active')
      hideInsertLine()
    }
  })

  centerCol.addEventListener('drop', e => {
    if (!isAdd(e) && !isMove(e)) return
    e.preventDefault()
    depth = 0
    centerCol.classList.remove('drop-active')

    const index = isMove(e) ? insertIndexAt(e.clientX, e.clientY) : -1
    hideInsertLine()

    const mime = isMove(e) ? DND_MOVE_MIME : DND_MIME
    let names = []
    try {
      names = JSON.parse(e.dataTransfer.getData(mime) || '[]')
    } catch {
      return
    }
    if (!Array.isArray(names) || names.length === 0) return

    isMove(e) ? reorderTarget(names, index) : addToTarget(names)
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
  syncFooter()
}

function removeFromTarget(names) {
  const drop = new Set(Array.isArray(names) ? names : [names])
  const before = state.targetOrder.length
  state.targetOrder = state.targetOrder.filter(n => !drop.has(n))
  if (state.targetOrder.length === before) return
  drop.forEach(n => state.selected.center.delete(n))
  renderAll()
  syncFooter()
}

function clearTarget() {
  if (state.targetOrder.length === 0) return
  state.targetOrder = []
  state.selected.center.clear()
  state.lastClicked.center = null
  renderAll()
  syncFooter()
}

// #5 および E2E から使う
window.__cyk = { state, seq, addToTarget, removeFromTarget, clearTarget, reorderTarget, renderAll }

// ---------- フッター ----------

function readSeqInputs() {
  seq.digits = clampInt(digitsInput.value, 4, 1, 10)
  seq.start = clampInt(startInput.value, 1, 0, Number.MAX_SAFE_INTEGER)
  seq.step = clampInt(stepInput.value, 1, 1, Number.MAX_SAFE_INTEGER)
}

function currentPrefix() {
  return prefixInput.value.trim()
}

function syncFooter() {
  const n = state.targetOrder.length
  const prefix = currentPrefix()

  targetCount.textContent = `対象 ${n} 件`

  if (n === 0) {
    sampleName.textContent = '中央列にファイルを追加してください'
  } else if (!prefix) {
    sampleName.textContent = 'プレフィックスを入力してください'
  } else {
    const ext = extOf(state.targetOrder[0])
    const first = `${prefix}_${seqLabel(0)}${ext}`
    if (n === 1) {
      sampleName.textContent = first
    } else {
      const lastExt = extOf(state.targetOrder[n - 1])
      sampleName.textContent = `${first} → ${prefix}_${seqLabel(n - 1)}${lastExt}`
    }
  }

  const ready = n > 0 && Boolean(prefix)
  renameBtn.disabled = !ready
  previewBtn.disabled = !ready
}

// リネームのたびに増やす。同じパスでも別のURLになるためキャッシュが効かない
let thumbGeneration = 0

function thumbUrl(file) {
  return `/api/thumbnail?path=${encodeURIComponent(file.path)}&v=${thumbGeneration}`
}

// 拡張子はサーバー側と同じく小文字化する
function extOf(name) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

// ---------- プレビューと実行 ----------

let currentPlan = null

async function fetchPlan() {
  const res = await fetch('/api/rename/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dir: state.dir,
      files: state.targetOrder,
      prefix: currentPrefix(),
      digits: seq.digits,
      start: seq.start,
      step: seq.step
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'プレビューの取得に失敗しました')
  return data
}

async function openPreview() {
  if (renameBtn.disabled) return
  try {
    currentPlan = await fetchPlan()
  } catch (err) {
    showError(err.message)
    return
  }
  modalStart.value = String(seq.start)
  renderPreview()
  modalBackdrop.hidden = false
}

async function refreshPreview() {
  if (modalBackdrop.hidden) return
  try {
    currentPlan = await fetchPlan()
    renderPreview()
  } catch {
    // 入力途中は取得に失敗しうるので黙って据え置く
  }
}

function renderPreview() {
  const { dir, plan, collisions } = currentPlan

  modalSub.textContent = `${plan.length} 件を変更します`
  modalDir.textContent = dir
  modalList.innerHTML = ''

  modal.classList.toggle('has-collision', collisions > 0)
  modalWarning.hidden = collisions === 0
  if (collisions > 0) {
    modalWarnTitle.textContent = `${collisions} 件が既存のファイルと衝突します`
    modalStartHint.textContent = 'を変更して回避'
  } else {
    modalStartHint.textContent = ''
  }

  const prefix = currentPrefix()
  plan.forEach(row => {
    const el = document.createElement('div')
    el.className = 'modal-row' + (row.collides ? ' collide' : '')
    el.dataset.from = row.from

    const from = document.createElement('div')
    from.className = 'from'
    from.textContent = row.from
    from.title = row.from

    const arrow = document.createElement('div')
    arrow.className = 'arrow-col'
    arrow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${row.collides ? '#e0705f' : '#555'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`

    const to = document.createElement('div')
    to.className = 'to'
    const label = document.createElement('span')
    label.className = 'label'
    // 連番部分だけ色を変える
    const seqPart = row.to.slice(prefix.length + 1, row.to.lastIndexOf('.'))
    label.innerHTML = `${escapeHtml(prefix)}_<span class="seq">${escapeHtml(seqPart)}</span>${escapeHtml(row.to.slice(row.to.lastIndexOf('.')))}`
    label.title = row.to
    to.appendChild(label)

    if (row.collides) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = row.reason === 'duplicate' ? '重複' : '既存'
      to.appendChild(tag)
    }

    el.append(from, arrow, to)
    modalList.appendChild(el)
  })

  modalApply.disabled = collisions > 0
}

function escapeHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

function closeModal() {
  modalBackdrop.hidden = true
  currentPlan = null
}

async function applyRename() {
  if (modalApply.disabled) return

  modalApply.disabled = true
  modalApply.textContent = '実行中...'

  try {
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dir: state.dir,
        files: state.targetOrder,
        prefix: currentPrefix(),
        digits: seq.digits,
        start: seq.start,
        step: seq.step
      })
    })
    const data = await res.json()

    if (!res.ok) {
      // 衝突が後から発生した場合はプレビューを取り直して見せる
      if (res.status === 409) {
        await refreshPreview()
        return
      }
      closeModal()
      showError(data.error || 'リネームに失敗しました')
      return
    }

    // 新しい名前のまま並び順を保つ。
    // data.renamed は計画順（＝中央列の並び順）で返るので、その to をそのまま使う。
    const newOrder = data.renamed.map(r => r.to)
    closeModal()
    await reloadAfterRename(newOrder)
    setCount(`${state.files.length} 件 — ${data.renamed.length} 件をリネームしました`)
  } catch {
    closeModal()
    showError('リネームに失敗しました')
  } finally {
    modalApply.textContent = '実行'
    modalApply.disabled = false
  }
}

// リネーム後はパスが変わるので読み直し、中央列は新しい名前で復元する
async function reloadAfterRename(newOrder) {
  thumbGeneration++   // 同じパスに別の画像が入るため、URLを変えて再取得させる
  const res = await fetch(`/api/images?dir=${encodeURIComponent(state.dir)}`)
  const data = await res.json()
  if (!res.ok) return showError(data.error || '読み込みに失敗しました')

  state.files = data.files
  const known = new Set(data.files.map(f => f.name))
  state.targetOrder = newOrder.filter(n => known.has(n))
  state.selected.left.clear()
  state.selected.right.clear()
  state.selected.center.clear()
  renderAll()
  syncFooter()
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
  state.dir = ''
  state.files = []
  state.targetOrder = []
  state.selected.left.clear()
  state.selected.right.clear()
  state.selected.center.clear()
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
