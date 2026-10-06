import { useEffect, useState } from 'react'
import type { BusName } from '../../shared/bus'
import { onFrames } from '../bus'
import { emptyRaw, ingest, read, type Currents, type Live } from './sideState'
import { EtaHold } from './etaHold'
import { StepFilter } from './stepFilter'

export type { Currents }

export type SideReading = { online: false } | (Live & { smooth: Currents; etaNetA: number | null })

export function useSide(bus: BusName, hz = 10): SideReading {
  const [reading, setReading] = useState<SideReading>({ online: false })
  useEffect(() => {
    const raw = emptyRaw()
    const off = onFrames(bus, (frames) => {
      const at = performance.now()
      for (const f of frames) ingest(raw, f, at)
    })
    const filters = { solarA: new StepFilter(), chargerA: new StepFilter(), propulsionA: new StepFilter(), houseA: new StepFilter() }
    const etaHold = new EtaHold()
    const timer = setInterval(() => {
      const now = performance.now()
      const r = read(raw, now)
      if (!r.online) {
        Object.values(filters).forEach((f) => f.clear())
        etaHold.clear()
        return setReading(r)
      }
      const smooth: Currents = {
        solarA: filters.solarA.push(now, r.solarA),
        chargerA: filters.chargerA.push(now, r.chargerA),
        propulsionA: filters.propulsionA.push(now, r.propulsionA),
        houseA: filters.houseA.push(now, r.houseA) ?? r.houseA,
      }
      const smoothNetA = (smooth.solarA ?? 0) + (smooth.chargerA ?? 0) - (smooth.propulsionA ?? 0) - smooth.houseA
      setReading({ ...r, smooth, etaNetA: etaHold.push(now, smoothNetA) })
    }, 1000 / hz)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [bus, hz])
  return reading
}
