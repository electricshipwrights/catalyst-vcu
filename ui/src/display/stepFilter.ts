const SLOW_TAU_S = 5
const FAST_TAU_S = 0.25
const STEP_MIN_A = 5
const STEP_FRACTION = 0.05
const STEP_HOLD_MS = 300
const SETTLE_MIN_A = 0.3
const SETTLE_FRACTION = 0.005

export class StepFilter {
  private y: number | null = null
  private at = 0
  private outsideSince: number | null = null
  private fast = false

  push(at: number, x: number | null) {
    if (x == null || this.y == null) {
      this.y = x
      this.at = at
      this.outsideSince = null
      this.fast = false
      return x
    }
    const dt = (at - this.at) / 1000
    this.at = at
    const err = Math.abs(x - this.y)
    if (err <= Math.max(STEP_MIN_A, Math.abs(this.y) * STEP_FRACTION)) this.outsideSince = null
    else this.outsideSince ??= at
    if (this.outsideSince != null && at - this.outsideSince >= STEP_HOLD_MS) this.fast = true
    else if (err <= Math.max(SETTLE_MIN_A, Math.abs(this.y) * SETTLE_FRACTION)) this.fast = false
    this.y += (x - this.y) * (1 - Math.exp(-dt / (this.fast ? FAST_TAU_S : SLOW_TAU_S)))
    return this.y
  }

  clear() {
    this.y = null
    this.outsideSince = null
    this.fast = false
  }
}
