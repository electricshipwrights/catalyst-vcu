import { useEffect, useRef, useState } from 'react'
import { onGatewayPackets } from '../bus'
import { onButton } from '../display/buttons'
import './slint.css'

// The Slint display (app/web) compiled to WebAssembly by `pnpm build:wasm`.
// It renders exactly what the device's LCD shows, from the gateway packets
// bus.ts hands it, and follows the vcu.* settings itself.
type Wasm = {
  default: () => Promise<unknown>
  start: (canvas: HTMLCanvasElement) => void
  // Missing from builds older than the A/B/C buttons
  press_button?: (index: number) => void
  // Missing from builds that read /bus themselves
  push_packet?: (bus: number, packet: Uint8Array) => void
}
const load: (() => Promise<Wasm>) | undefined = import.meta.glob<Wasm>('./pkg/vcu_web.js')['./pkg/vcu_web.js']

// Slint's platform can only be set up once per page
let started = false

export function SlintDisplay() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(load ? null : 'not built: run pnpm build:wasm')
  useEffect(() => {
    if (!load || started || !canvas.current) return
    started = true
    const target = canvas.current
    load()
      .then(async (m) => {
        await m.default()
        m.start(target)
        onButton((i) => m.press_button?.(i))
        onGatewayPackets((bus, packet) => m.push_packet?.(bus, packet))
      })
      .catch((e) => setError(String(e)))
  }, [])
  return (
    <div className="slint-lcd">
      <canvas ref={canvas} width={320} height={240} />
      {error && <div className="slint-error">{error}</div>}
    </div>
  )
}
