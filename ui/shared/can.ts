export type Frame = { id: number; ext: boolean; data: Uint8Array; t: number }
export type WireFrame = { id: number; ext: boolean; data: string; t: number }

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()

export function fromHex(hex: string) {
  const out = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export const fromWire = (f: WireFrame): Frame => ({ ...f, data: fromHex(f.data) })

export const formatId = (id: number, ext: boolean) =>
  id.toString(16).toUpperCase().padStart(ext ? 8 : 3, '0')

export const toSlcan = (f: WireFrame) =>
  `${f.ext ? 'T' : 't'}${formatId(f.id, f.ext)}${f.data.length / 2}${f.data}`

export type SlcanFrame = { id: number; ext: boolean; data: string; stamp: number | null }

export function parseSlcan(line: string): SlcanFrame | null {
  const s = line.trim()
  const ext = s[0] === 'T'
  if (!ext && s[0] !== 't') return null
  const idLen = ext ? 8 : 3
  const id = parseInt(s.slice(1, 1 + idLen), 16)
  const dlc = parseInt(s[1 + idLen], 16)
  const start = 2 + idLen
  const data = s.slice(start, start + dlc * 2)
  if (Number.isNaN(id) || Number.isNaN(dlc) || data.length !== dlc * 2) return null
  const rest = s.slice(start + dlc * 2)
  return { id, ext, data: data.toUpperCase(), stamp: rest.length === 4 ? parseInt(rest, 16) : null }
}

export function parseCandump(line: string): Omit<WireFrame, 't'> | null {
  const m = /^\(\d+\.\d+\)\s+\S+\s+([0-9A-Fa-f]+)#([0-9A-Fa-f]*)$/.exec(line.trim())
  if (!m) return null
  return { id: parseInt(m[1], 16), ext: m[1].length > 3, data: m[2].toUpperCase() }
}
