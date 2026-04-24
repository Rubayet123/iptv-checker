// Parse raw M3U text into array of channel objects
export function parseM3U(text) {
  const entries = []
  let meta = {}
  const lines = text.trim().split('\n')

  for (let line of lines) {
    line = line.trim()
    if (!line || line.startsWith('#EXTM3U')) continue

    if (line.startsWith('#EXTINF')) {
      meta = parseExtInf(line)
    } else if (!line.startsWith('#')) {
      entries.push({ ...meta, url: line })
      meta = {}
    }
  }
  return entries
}

function parseExtInf(line) {
  const meta = {}
  const attrs = ['tvg-id','tvg-name','tvg-logo','tvg-country','tvg-language','group-title']
  for (const key of attrs) {
    const m = line.match(new RegExp(`${key}="([^"]*)"`, 'i'))
    meta[key] = m ? m[1] : ''
  }
  const nameMatch = line.match(/,(.+)$/)
  meta.name = nameMatch ? nameMatch[1].trim() : ''
  return meta
}

export function entriesToM3U(entries) {
  const lines = ['#EXTM3U']
  for (const e of entries) {
    const name = e.name || e['tvg-name'] || 'Unknown'
    const attrKeys = ['tvg-id','tvg-name','tvg-logo','tvg-country','tvg-language','group-title']
    const attrs = attrKeys
      .filter(k => e[k])
      .map(k => `${k}="${e[k]}"`)
      .join(' ')
    lines.push(`#EXTINF:-1 ${attrs},${name}`)
    lines.push(e.url || '')
  }
  return lines.join('\n')
}
