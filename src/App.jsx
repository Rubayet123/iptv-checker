import { useState, useRef, useCallback, useEffect } from 'react'
import { parseM3U, entriesToM3U } from './m3uParser'
import { runBatch } from './checker'
import './index.css'

const FILTERS = ['All', 'LIVE', 'DEAD', 'TIMEOUT', 'PENDING']
const DEFAULT_PROXY = 'https://api.allorigins.win/raw?url='

function StatusBadge({ status }) {
  return (
    <span className={`badge b-${status}`}>
      <span className={`dot d-${status}`} />
      {status}
    </span>
  )
}

function useToast() {
  const [toast, setToast] = useState(null)
  const show = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])
  return [toast, show]
}

export default function App() {
  const [rawText, setRawText]       = useState('')
  const [entries, setEntries]       = useState([])
  const [results, setResults]       = useState({}) // url -> {status,latencyMs,note}
  const [running, setRunning]       = useState(false)
  const [filter, setFilter]         = useState('All')
  const [search, setSearch]         = useState('')
  const [sortCol, setSortCol]       = useState(null)
  const [sortAsc, setSortAsc]       = useState(true)
  const [workers, setWorkers]       = useState(10)
  const [timeout, setTimeout_]      = useState(8)
  const [proxy, setProxy]           = useState(DEFAULT_PROXY)
  const [done, setDone]             = useState(0)
  const [eta, setEta]               = useState('')
  const [toast, showToast]          = useToast()

  const stopSignal  = useRef({ current: false })
  const startTsRef  = useRef(0)
  const fileRef     = useRef()

  // ── Parse ────────────────────────────────────────────────────────────────
  const handleParse = useCallback(() => {
    if (!rawText.trim()) return
    const parsed = parseM3U(rawText)
    setEntries(parsed)
    const init = {}
    for (const e of parsed) init[e.url] = { status: 'PENDING', latencyMs: null, note: '' }
    setResults(init)
    setDone(0)
    setEta('')
    showToast(`${parsed.length} channels loaded`)
  }, [rawText, showToast])

  const handleClear = () => {
    setRawText('')
    setEntries([])
    setResults({})
    setDone(0)
    setEta('')
  }

  const handleFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = ev => setRawText(ev.target.result)
    reader.readAsText(f, 'utf-8')
    e.target.value = ''
  }

  // ── Check ─────────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!entries.length) return
    setRunning(true)
    stopSignal.current = { current: false }
    startTsRef.current = performance.now()

    // Reset all to PENDING
    const init = {}
    for (const e of entries) init[e.url] = { status: 'PENDING', latencyMs: null, note: '' }
    setResults({ ...init })
    setDone(0)

    let completed = 0
    const total = entries.length

    await runBatch({
      entries,
      concurrency: workers,
      timeoutMs: timeout * 1000,
      proxyBase: proxy,
      stopSignal: stopSignal.current,
      onResult: (i, url, result) => {
        completed++
        setDone(completed)
        setResults(prev => ({ ...prev, [url]: result }))

        const elapsed = (performance.now() - startTsRef.current) / 1000
        const rate = completed / elapsed
        const remaining = total - completed
        const etaSec = rate > 0 ? Math.round(remaining / rate) : 0
        setEta(`${completed}/${total} · ${rate.toFixed(1)}/s · ~${etaSec}s left`)
      },
    })

    setRunning(false)
    setEta('')
    showToast('Check complete!')
  }, [entries, workers, timeout, proxy, showToast])

  const handleStop = () => {
    stopSignal.current.current = true
    setRunning(false)
    setEta('Stopped')
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = { total: entries.length, LIVE: 0, DEAD: 0, TIMEOUT: 0, PENDING: 0 }
  for (const r of Object.values(results)) {
    const s = r.status === 'CHECKING' ? 'PENDING' : r.status
    if (s in stats) stats[s]++
  }

  // ── Filtered + sorted rows ─────────────────────────────────────────────
  let rows = entries.map((e, i) => ({
    i,
    n: i + 1,
    name: e.name || e['tvg-name'] || '',
    group: e['group-title'] || '',
    url: e.url || '',
    ...(results[e.url] || { status: 'PENDING', latencyMs: null, note: '' }),
  }))

  if (filter !== 'All') rows = rows.filter(r => r.status === filter)
  if (search.trim()) {
    const q = search.toLowerCase()
    rows = rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.group.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q)
    )
  }
  if (sortCol) {
    rows = [...rows].sort((a, b) => {
      let av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      if (sortCol === 'latencyMs') { av = av ?? Infinity; bv = bv ?? Infinity }
      const cmp = typeof av === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
  }

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const exportCSV = (liveOnly = false) => {
    const data = (liveOnly ? entries.filter(e => results[e.url]?.status === 'LIVE') : entries)
      .map(e => {
        const r = results[e.url] || {}
        return [
          `"${(e.name||'').replace(/"/g,'""')}"`,
          `"${(e['tvg-id']||'').replace(/"/g,'""')}"`,
          `"${(e['group-title']||'').replace(/"/g,'""')}"`,
          `"${(e.url||'').replace(/"/g,'""')}"`,
          r.status || 'PENDING',
          r.latencyMs != null ? r.latencyMs + 'ms' : '-',
          `"${(r.note||'').replace(/"/g,'""')}"`,
        ].join(',')
      })
    const csv = 'name,tvg-id,group,url,status,latency,note\n' + data.join('\n')
    download(csv, liveOnly ? 'live_streams.csv' : 'stream_check_results.csv', 'text/csv')
  }

  const exportM3U = () => {
    const live = entries.filter(e => results[e.url]?.status === 'LIVE')
    if (!live.length) { showToast('No LIVE streams to export'); return }
    download(entriesToM3U(live), 'live_only.m3u', 'text/plain')
    showToast(`Exported ${live.length} live streams`)
  }

  const download = (content, filename, mime) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: mime }))
    a.download = filename
    a.click()
  }

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url).then(() => showToast('URL copied'))
  }

  const pct = entries.length ? Math.round((done / entries.length) * 100) : 0

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo-icon">IP</div>
        <div>
          <div className="logo-title">IPTV Stream Checker</div>
          <div className="logo-sub">Live · Dead · Timeout detection</div>
        </div>
        <div className="hdr-spacer" />
        <div className="hdr-badge">
          <span>{stats.LIVE}</span> live / {stats.total} total
        </div>
        <a className="hdr-link" href="https://github.com" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      {/* Proxy notice */}
      <div className="proxy-banner">
        <span>⚡</span>
        <span>
          Checks via <b>allorigins.win</b> CORS proxy by default. For faster + private checks,{' '}
          <a href="#" onClick={e => { e.preventDefault(); document.getElementById('proxy-input')?.focus() }}>
            set your own Cloudflare Worker proxy below
          </a>
          .
        </span>
      </div>

      <div className="main">
        {/* Left panel */}
        <div className="left">
          <div className="pnl-hdr">
            <div className="pnl-title">Playlist Input</div>
            <div className="pnl-sub">Paste M3U text or load a file</div>
          </div>

          <div className="textarea-wrap">
            <textarea
              className="m3u-ta"
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder={"#EXTM3U\n#EXTINF:-1 group-title=\"News\",BBC World\nhttp://stream.example.com/bbc\n\nPaste your full M3U playlist here..."}
              spellCheck={false}
            />
          </div>

          <div className="pnl-actions">
            <div className="btn-row">
              <button className="btn btn-ghost btn-full" onClick={() => fileRef.current.click()}>
                📂 Load .m3u file
              </button>
              <input ref={fileRef} type="file" accept=".m3u,.m3u8,.txt" style={{display:'none'}} onChange={handleFile} />
            </div>
            <div className="btn-row">
              <button className="btn btn-primary btn-full" onClick={handleParse} disabled={!rawText.trim()}>
                ▶ Parse Channels
              </button>
              <button className="btn btn-ghost" onClick={handleClear} title="Clear all">✕</button>
            </div>

            <div className="btn-row" style={{marginTop:4}}>
              {!running ? (
                <button
                  className="btn btn-primary btn-full"
                  onClick={handleStart}
                  disabled={!entries.length || running}
                  style={{background:'#7c3aed', borderColor:'#7c3aed'}}
                >
                  🔍 Check All Streams
                </button>
              ) : (
                <button className="btn btn-stop btn-full" onClick={handleStop}>
                  ⏹ Stop
                </button>
              )}
            </div>

            <div className="btn-row">
              <button className="btn btn-ghost btn-full" onClick={() => exportCSV(false)} disabled={!entries.length}>
                ⬇ Export CSV
              </button>
              <button className="btn btn-ghost btn-full" onClick={exportM3U} disabled={!stats.LIVE}>
                ⬇ Live .m3u
              </button>
            </div>
          </div>

          {/* Settings */}
          <div className="settings">
            <div className="s-item">
              <label className="s-label">Workers</label>
              <input
                className="s-ctrl"
                type="number" min={1} max={50}
                value={workers}
                onChange={e => setWorkers(Number(e.target.value))}
              />
            </div>
            <div className="s-item">
              <label className="s-label">Timeout (s)</label>
              <input
                className="s-ctrl"
                type="number" min={2} max={30}
                value={timeout}
                onChange={e => setTimeout_(Number(e.target.value))}
              />
            </div>
            <div className="s-item" style={{gridColumn:'1/-1'}}>
              <label className="s-label">CORS Proxy URL</label>
              <input
                id="proxy-input"
                className="s-ctrl"
                value={proxy}
                onChange={e => setProxy(e.target.value)}
                placeholder="https://api.allorigins.win/raw?url="
              />
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="right">
          {/* Stats */}
          <div className="stats-bar">
            <div className="s-chip c-total">
              <div className="s-val">{stats.total}</div>
              <div className="s-lbl">Total</div>
            </div>
            <div className="s-chip c-live">
              <div className="s-val">{stats.LIVE}</div>
              <div className="s-lbl">Live</div>
            </div>
            <div className="s-chip c-dead">
              <div className="s-val">{stats.DEAD}</div>
              <div className="s-lbl">Dead</div>
            </div>
            <div className="s-chip c-timeout">
              <div className="s-val">{stats.TIMEOUT}</div>
              <div className="s-lbl">Timeout</div>
            </div>
            <div className="s-chip c-pending">
              <div className="s-val">{stats.PENDING}</div>
              <div className="s-lbl">Pending</div>
            </div>
            <div className="s-spacer" />
            <div className="prog-wrap">
              <div className="prog-track">
                <div className="prog-fill" style={{width: pct + '%'}} />
              </div>
              <div className="prog-text">{pct}%</div>
            </div>
          </div>

          {/* Controls */}
          <div className="ctrl-bar">
            <div className="filter-tabs">
              {FILTERS.map(f => (
                <button
                  key={f}
                  className={`f-tab${filter===f?' active':''} ${f==='LIVE'?'fl':f==='DEAD'?'fd':f==='TIMEOUT'?'ft':''}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                  {f !== 'All' && (
                    <span style={{marginLeft:4, opacity:.7}}>
                      {f==='LIVE'?stats.LIVE:f==='DEAD'?stats.DEAD:f==='TIMEOUT'?stats.TIMEOUT:stats.PENDING}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <input
              className="search-box"
              placeholder="Search name, group, URL..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="ctrl-spacer" />
            {eta && <div className="eta-txt">{eta}</div>}
          </div>

          {/* Table */}
          <div className="tbl-wrap">
            {entries.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📡</div>
                <div className="empty-title">No channels loaded</div>
                <div className="empty-sub">Paste an M3U playlist and click Parse</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="col-n"   onClick={() => handleSort('n')}>#</th>
                    <th className="col-st"  onClick={() => handleSort('status')}>Status {sortCol==='status'?(sortAsc?'▲':'▼'):''}</th>
                    <th className="col-nm"  onClick={() => handleSort('name')}>Name {sortCol==='name'?(sortAsc?'▲':'▼'):''}</th>
                    <th className="col-gr"  onClick={() => handleSort('group')}>Group {sortCol==='group'?(sortAsc?'▲':'▼'):''}</th>
                    <th className="col-url">URL</th>
                    <th className="col-lat" onClick={() => handleSort('latencyMs')}>ms {sortCol==='latencyMs'?(sortAsc?'▲':'▼'):''}</th>
                    <th className="col-note">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.url + row.i}>
                      <td className="td-n">{row.n}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="td-name" title={row.name}>{row.name}</td>
                      <td title={row.group}>{row.group}</td>
                      <td
                        className="td-url"
                        title={row.url}
                        onClick={() => copyUrl(row.url)}
                      >
                        {row.url}
                      </td>
                      <td className="td-lat">
                        {row.latencyMs != null ? row.latencyMs : '—'}
                      </td>
                      <td className="td-note" title={row.note}>{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
