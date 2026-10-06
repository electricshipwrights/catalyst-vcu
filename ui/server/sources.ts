import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { parseCandump, parseSlcan, type WireFrame } from '../shared/can'
import type { BusStatus } from '../shared/bus'

export interface Source {
  kind: 'replay' | 'candump'
  start(emit: (f: WireFrame) => void): void
  stop(): void
  status(): Partial<BusStatus>
}

type Timed = { at: number; frame: Omit<WireFrame, 't'> }

export class ReplaySource implements Source {
  kind = 'replay' as const
  private frames: Timed[] = []
  private duration = 0
  private position = 0
  private cursor = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(readonly file: string, public speed = 1) {
    let at = 0
    let prev: number | null = null
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const f = parseSlcan(line)
      if (!f) continue
      if (f.stamp == null) at += 10
      else if (prev != null) at += (f.stamp - prev + 60000) % 60000
      prev = f.stamp ?? prev
      this.frames.push({ at, frame: { id: f.id, ext: f.ext, data: f.data } })
    }
    this.duration = at
  }

  start(emit: (f: WireFrame) => void) {
    let last = performance.now()
    this.timer = setInterval(() => {
      const now = performance.now()
      this.position += (now - last) * this.speed
      last = now
      while (this.cursor < this.frames.length && this.frames[this.cursor].at <= this.position) {
        emit({ ...this.frames[this.cursor++].frame, t: Date.now() })
      }
      if (this.cursor >= this.frames.length) {
        this.cursor = 0
        this.position = 0
      }
    }, 5)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  status(): Partial<BusStatus> {
    return {
      detail: this.frames.length ? undefined : 'no SLCAN frames found in file',
      replay: { file: path.basename(this.file), speed: this.speed, position: this.position, duration: this.duration },
    }
  }
}

export class CandumpSource implements Source {
  kind = 'candump' as const
  private proc: ChildProcess | null = null
  private detail: string

  constructor(readonly iface: string) {
    this.detail = `candump -L ${iface}`
  }

  start(emit: (f: WireFrame) => void) {
    this.proc = spawn('candump', ['-L', this.iface])
    this.proc.on('error', (e) => (this.detail = `candump failed: ${e.message}`))
    this.proc.on('exit', (code) => (this.detail = `candump exited (${code})`))
    createInterface({ input: this.proc.stdout! }).on('line', (line) => {
      const f = parseCandump(line)
      if (f) emit({ ...f, t: Date.now() })
    })
  }

  stop() {
    this.proc?.kill()
  }

  status(): Partial<BusStatus> {
    return { detail: this.detail }
  }
}
