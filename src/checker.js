// Stream checking via a CORS-friendly proxy approach.
// We use allorigins.win or a user-supplied Cloudflare Worker proxy.
// The checker tries multiple probe strategies and returns a result.

const DEFAULT_PROXY = 'https://api.allorigins.win/raw?url='

// Probe a single URL. Returns { status, latencyMs, note }
// status: 'LIVE' | 'DEAD' | 'TIMEOUT'
export async function probeStream(url, timeoutMs = 8000, proxyBase = DEFAULT_PROXY) {
  if (!url || !url.trim()) return { status: 'DEAD', latencyMs: null, note: 'Empty URL' }

  const t0 = performance.now()

  // Strategy 1: direct fetch with HEAD (works if server has CORS or is same-origin)
  // Strategy 2: via allorigins proxy (works for HTTP streams)
  // We try direct first (fast fail), then proxied.

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Try proxied GET with small range
    const probeUrl = proxyBase + encodeURIComponent(url)
    const res = await fetch(probeUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Range': 'bytes=0-512' },
    })
    clearTimeout(timer)
    const ms = Math.round(performance.now() - t0)

    if (res.ok || res.status === 206 || res.status === 200) {
      return { status: 'LIVE', latencyMs: ms, note: `HTTP ${res.status}` }
    }
    if (res.status === 403 || res.status === 401) {
      // Protected but server is alive — count as LIVE (auth required)
      return { status: 'LIVE', latencyMs: ms, note: `HTTP ${res.status} (auth)` }
    }
    if (res.status >= 400 && res.status < 500) {
      return { status: 'DEAD', latencyMs: ms, note: `HTTP ${res.status}` }
    }
    if (res.status >= 500) {
      return { status: 'DEAD', latencyMs: ms, note: `Server error ${res.status}` }
    }
    return { status: 'LIVE', latencyMs: ms, note: `HTTP ${res.status}` }

  } catch (err) {
    clearTimeout(timer)
    const ms = Math.round(performance.now() - t0)
    const msg = err?.message || String(err)

    if (err.name === 'AbortError' || msg.toLowerCase().includes('timeout')) {
      return { status: 'TIMEOUT', latencyMs: null, note: 'Request timed out' }
    }
    if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) {
      // Could be CORS block on proxy — try direct HEAD as fallback
      return await directHeadFallback(url, timeoutMs, t0)
    }
    return { status: 'DEAD', latencyMs: ms, note: msg.slice(0, 48) }
  }
}

async function directHeadFallback(url, timeoutMs, t0) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 5000))
  try {
    await fetch(url, { method: 'HEAD', signal: controller.signal, mode: 'no-cors' })
    clearTimeout(timer)
    // no-cors returns opaque response — if we got here without throw, host is reachable
    const ms = Math.round(performance.now() - t0)
    return { status: 'LIVE', latencyMs: ms, note: 'Reachable (opaque)' }
  } catch (err) {
    clearTimeout(timer)
    const msg = err?.message || String(err)
    if (err.name === 'AbortError') {
      return { status: 'TIMEOUT', latencyMs: null, note: 'Timed out' }
    }
    return { status: 'DEAD', latencyMs: null, note: 'Unreachable' }
  }
}

// Run a batch of probes with a worker pool
// onResult(index, url, result) called as each completes
export async function runBatch({ entries, concurrency, timeoutMs, proxyBase, onResult, stopSignal }) {
  const queue = [...entries.map((e, i) => ({ i, url: e.url || '' }))]
  let active = 0

  return new Promise(resolve => {
    let completed = 0
    const total = queue.length

    function next() {
      if (stopSignal?.current) { resolve(); return }
      if (queue.length === 0 && active === 0) { resolve(); return }
      while (active < concurrency && queue.length > 0) {
        const { i, url } = queue.shift()
        active++
        probeStream(url, timeoutMs, proxyBase).then(result => {
          active--
          completed++
          onResult(i, url, result)
          next()
        })
      }
    }
    next()
  })
}
