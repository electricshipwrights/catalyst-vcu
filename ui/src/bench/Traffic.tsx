import { useEffect, useState } from 'react'
import { formatId, toHex } from '../../shared/can'
import type { GatewayFrame } from '../../shared/gateway'
import { onGatewayFrames } from '../bus'
import { describe } from './describe'

type Entry = { frame: GatewayFrame; count: number; hz: number; seen: number }
type Row = { key: string; id: string; hz: number; data: string; name: string; value: string }

const WINDOW_MS = 500

// The frames on one gateway bus, one row per ID
export function Traffic({ bus }: { bus: number }) {
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    const entries = new Map<string, Entry>()
    const off = onGatewayFrames((frames) => {
      const now = performance.now()
      for (const f of frames) {
        if (f.bus !== bus) continue
        const key = `${f.ext ? 'x' : 's'}${f.id}`
        const e = entries.get(key) ?? { frame: f, count: 0, hz: 0, seen: now }
        e.frame = f
        e.count++
        e.seen = now
        entries.set(key, e)
      }
    })
    const timer = setInterval(() => {
      const now = performance.now()
      for (const [key, e] of entries) {
        if (now - e.seen > 3000) entries.delete(key)
        e.hz = e.hz ? e.hz * 0.5 + (e.count * 1000) / WINDOW_MS * 0.5 : (e.count * 1000) / WINDOW_MS
        e.count = 0
      }
      setRows(
        [...entries.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, e]) => ({
            key,
            id: formatId(e.frame.id, e.frame.ext),
            hz: e.hz,
            data: toHex(e.frame.data),
            ...describe(e.frame),
          })),
      )
    }, WINDOW_MS)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [bus])

  return (
    <table className="traffic">
      <thead>
        <tr>
          <th>ID</th>
          <th>Hz</th>
          <th>data</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="quiet">no frames</td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.key} title={r.name}>
            <td>{r.id}</td>
            <td>{r.hz.toFixed(r.hz < 10 ? 1 : 0)}</td>
            <td>
              <code>{r.data}</code>
              <div className="decoded">
                {r.name} <b>{r.value}</b>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
