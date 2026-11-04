import { useEffect, useState } from 'react'
import type { BusName } from '../../shared/bus'
import { sideBuses } from '../../shared/gateway'
import { onGatewayFrames } from '../bus'
import { emptyRaw, ingest, read, type Currents, type Live } from './sideState'
import { EtaHold } from './etaHold'
import { StepFilter } from './stepFilter'

export type { Currents }

export type SideReading = { online: false } | (Live & { smooth: Currents; etaNetA: number | null })

// One side's reading, from the gateway buses that concern it (GATEWAY.md)
export function useSide(side: BusName, hz = 10): SideReading {
  const [reading, setReading] = useState<SideReading>({ online: false })
  useEffect(() => {
    const raw = emptyRaw(side)
    const buses = sideBuses(side)
    const off = onGatewayFrames((frames) => {
      const at = performance.now()
      for (const f of frames) if (buses.has(f.bus)) ingest(raw, f, at)
    })
    const filters = { solarA: new StepFilter(), chargerA: new StepFilter(), propulsionA: new StepFilter(), houseA: new StepFilter(), heaterA: new StepFilter(), inverterA: new StepFilter() }
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
        heaterA: filters.heaterA.push(now, r.heaterA),
        inverterA: filters.inverterA.push(now, r.inverterA),
      }
      const smoothNetA = (smooth.solarA ?? 0) + (smooth.chargerA ?? 0) - (smooth.propulsionA ?? 0) - smooth.houseA
      setReading({ ...r, smooth, etaNetA: etaHold.push(now, smoothNetA) })
    }, 1000 / hz)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [side, hz])
  return reading
}
