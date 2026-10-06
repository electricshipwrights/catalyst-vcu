import { useMemo, useRef, useState } from 'react'
import { BatteryBox } from './bench/BatteryBox'
import { Harness } from './bench/Harness'
import { Presets } from './bench/Presets'
import { SmoothingToggle, SpeedToggle, ThemeToggle } from './bench/Toggles'
import { useServerStatus } from './bus'
import { Display } from './display/Display'

const displayOnly = new URLSearchParams(location.search).has('display')

export function App() {
  const status = useServerStatus()
  const [zoom, setZoom] = useState(2)
  const stageRef = useRef<HTMLDivElement>(null)
  const bezelRef = useRef<HTMLDivElement>(null)
  const portRef = useRef<HTMLDivElement>(null)
  const stbdRef = useRef<HTMLDivElement>(null)
  const boxRefs = useMemo(() => ({ port: portRef, stbd: stbdRef }), [])

  if (displayOnly) return <Display />

  const port = status?.buses.find((b) => b.bus === 'port')
  const stbd = status?.buses.find((b) => b.bus === 'stbd')
  const logs = status?.logs ?? []

  return (
    <main className="bench">
      <div className="toolbar">
        <div className="controls">
          <Presets />
          <SmoothingToggle />
          <SpeedToggle />
        </div>
        <div className="controls controls-end">
          <div className="device-meta">
            <span>CoreMP135 · 320×240</span>
            {[1, 2, 3].map((z) => (
              <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                {z}×
              </button>
            ))}
            <a href="?display" target="_blank">
              display only
            </a>
          </div>
          <ThemeToggle />
        </div>
      </div>
      <div className="stage" ref={stageRef}>
        <Harness
          stage={stageRef}
          display={bezelRef}
          boxes={boxRefs}
          live={{ port: !!port?.fps, stbd: !!stbd?.fps }}
        />
        <div className="box-slot" ref={portRef}>
          <BatteryBox bus="port" status={port} logs={logs} />
        </div>
        <div className="bezel" ref={bezelRef}>
          <div style={{ zoom }}>
            <Display />
          </div>
        </div>
        <div className="box-slot" ref={stbdRef}>
          <BatteryBox bus="stbd" status={stbd} logs={logs} />
        </div>
      </div>
    </main>
  )
}
