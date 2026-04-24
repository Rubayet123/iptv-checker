/**
 * IPTV Stream Checker — Cloudflare Worker Proxy
 * 
 * Deploy this at: https://dash.cloudflare.com -> Workers -> Create Worker
 * Then paste this code and deploy.
 * 
 * Your worker URL will be: https://iptv-checker.YOUR-SUBDOMAIN.workers.dev
 * Set that as the proxy base in the app:
 *   https://iptv-checker.YOUR-SUBDOMAIN.workers.dev/probe?url=
 */

const ALLOWED_ORIGINS = [
  'https://YOUR-USERNAME.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const url = new URL(request.url)
    const target = url.searchParams.get('url')

    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate URL scheme
    let parsedTarget
    try {
      parsedTarget = new URL(target)
    } catch {
      return new Response(JSON.stringify({ status: 'DEAD', note: 'Invalid URL' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
      return new Response(JSON.stringify({ status: 'DEAD', note: `Unsupported protocol: ${parsedTarget.protocol}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const t0 = Date.now()

    try {
      const res = await fetch(target, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; IPTVChecker/1.0)',
          'Range': 'bytes=0-1024',
        },
        signal: AbortSignal.timeout(10000),
        cf: { cacheTtl: 0, cacheEverything: false },
      })

      const ms = Date.now() - t0

      if (res.ok || res.status === 206) {
        return new Response(JSON.stringify({
          status: 'LIVE',
          latencyMs: ms,
          note: `HTTP ${res.status}`,
          contentType: res.headers.get('content-type') || '',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      if (res.status === 401 || res.status === 403) {
        return new Response(JSON.stringify({
          status: 'LIVE',
          latencyMs: ms,
          note: `HTTP ${res.status} (auth required)`,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      return new Response(JSON.stringify({
        status: 'DEAD',
        latencyMs: ms,
        note: `HTTP ${res.status}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    } catch (err) {
      const ms = Date.now() - t0
      const msg = err?.message || String(err)
      const isTimeout = msg.includes('timeout') || msg.includes('Timeout') || msg.includes('timed out')

      return new Response(JSON.stringify({
        status: isTimeout ? 'TIMEOUT' : 'DEAD',
        latencyMs: isTimeout ? null : ms,
        note: isTimeout ? 'Timed out' : msg.slice(0, 60),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  }
}
