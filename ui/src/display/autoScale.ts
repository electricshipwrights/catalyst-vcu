// The bars' full scale, shared by both sides so they stay comparable: the
// smallest scale that fits. It steps up as soon as a bar nears its end (a
// brief hold skips single-frame spikes), and down once the last 8 s of the
// bars have all fit within 90% of a smaller scale. 100 A (up at 96) covers
// cruise (≈ 88 A a side with the house load) and shore charging (80 A); full
// throttle (a motor's ≈ 293 A plus the house) needs 400.
export const SCALE_STEPS_A = [50, 100, 200, 300, 400]
export const SCALE_DEFAULT_A = 100
const UP_AT = 0.96
const UP_AFTER_MS = 300
const DOWN_AT = 0.9 // of the smaller scale
const DOWN_AFTER_MS = 8000

const TOP_A = SCALE_STEPS_A[SCALE_STEPS_A.length - 1]

export class AutoScale {
  maxA = SCALE_DEFAULT_A
  private overSince: number | null = null
  // The last DOWN_AFTER_MS of the longest bar, and since when it's had data
  private recent: { at: number; a: number }[] = []
  private since: number | null = null

  // needA: the longest bar in amps, or null with no data (the scale holds)
  push(at: number, needA: number | null) {
    if (needA == null) {
      this.overSince = null
      this.recent = []
      this.since = null
      return this.maxA
    }
    this.since ??= at
    this.recent.push({ at, a: needA })
    while (at - this.recent[0].at > DOWN_AFTER_MS) this.recent.shift()

    if (needA > this.maxA * UP_AT && this.maxA < TOP_A) {
      this.overSince ??= at
      if (at - this.overSince >= UP_AFTER_MS) {
        this.maxA = SCALE_STEPS_A.find((s) => needA <= s * UP_AT) ?? TOP_A
        this.overSince = null
      }
      return this.maxA
    }
    this.overSince = null
    // Down to the smallest scale the whole window fits, once there's a full window
    if (at - this.since >= DOWN_AFTER_MS) {
      const peakA = Math.max(...this.recent.map((r) => r.a))
      const fits = SCALE_STEPS_A.find((s) => peakA <= s * DOWN_AT) ?? TOP_A
      if (fits < this.maxA) this.maxA = fits
    }
    return this.maxA
  }
}
