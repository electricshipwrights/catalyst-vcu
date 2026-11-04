import { useRef, useState } from 'react'
import { GatewayPanel } from './bench/Gateway'
import { Harness } from './bench/Harness'
import { NmeaBox } from './bench/Nmea'
import { Presets } from './bench/Presets'
import { SideColumn } from './bench/Side'
import { Specs } from './bench/Specs'
import { RendererToggle, SmoothingToggle, SpeedToggle, ThemeToggle } from './bench/Toggles'
import { useServerStatus } from './bus'
import { BUTTONS, pressButton } from './display/buttons'
import { Display } from './display/Display'
import { useRenderer } from './display/settings'
import { SlintDisplay } from './slint/SlintDisplay'

const displayOnly = new URLSearchParams(location.search).has('display')

// The React prototype or the Slint build of the same display. Slint stays
// mounted once used, since it can't move to a new canvas. CSS zoom would make
// Slint's window bigger instead of scaling it, so its canvas is scaled with a
// transform.
function Screen({ zoom = 1 }: { zoom?: number }) {
  const renderer = useRenderer()
  const [slintUsed, setSlintUsed] = useState(renderer === 'slint')
  if (renderer === 'slint' && !slintUsed) setSlintUsed(true)
  return (
    <>
      {renderer === 'react' && (
        <div style={{ zoom }}>
          <Display />
        </div>
      )}
      {slintUsed && (
        <div hidden={renderer !== 'slint'} style={{ width: 320 * zoom, height: 240 * zoom }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
            <SlintDisplay />
          </div>
        </div>
      )}
    </>
  )
}

export function App() {
  const status = useServerStatus()
  const [zoom, setZoom] = useState(2)
  const stageRef = useRef<HTMLDivElement>(null)
  const bezelRef = useRef<HTMLDivElement>(null)
  const gatewayRef = useRef<HTMLDivElement>(null)

  if (displayOnly) return <Screen />

  const port = status?.buses.find((b) => b.bus === 'port')
  const stbd = status?.buses.find((b) => b.bus === 'stbd')
  const logs = status?.logs ?? []
  const fps = status?.gateway.fps ?? {}

  return (
    <main className="bench">
      <div className="toolbar">
        <div className="controls">
          <Presets />
          <SmoothingToggle />
          <SpeedToggle />
          <ThemeToggle />
        </div>
        <div className="controls controls-end">
          <div className="device-meta">
            <span>CoreMP135 · 320×240</span>
            {[1, 2].map((z) => (
              <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                {z}×
              </button>
            ))}
            <a href="?display" target="_blank">
              display only
            </a>
          </div>
          <RendererToggle />
        </div>
      </div>
      <div className="stage" ref={stageRef}>
        <Harness stage={stageRef} display={bezelRef} gateway={gatewayRef} fps={fps} />
        <SideColumn side="port" status={port} fps={fps} logs={logs}>
          <NmeaBox buses={status?.buses} fps={fps} />
        </SideColumn>
        <div className="board-col">
          <div className="bezel" ref={bezelRef}>
            {/* The board is mounted upside down, so its buttons are above the screen */}
            <div className="hw-buttons" style={{ width: 320 * zoom }}>
              {BUTTONS.map((label, i) => (
                <button key={label} onClick={() => pressButton(i)} aria-label={`button ${label}`}>
                  {label}
                </button>
              ))}
            </div>
            <Screen zoom={zoom} />
          </div>
          <div className="gateway-slot" ref={gatewayRef}>
            <GatewayPanel status={status?.gateway} />
          </div>
          <Specs />
        </div>
        <SideColumn side="stbd" status={stbd} fps={fps} logs={logs} />
      </div>
    </main>
  )
}
