// The bars' full scale, shared by both sides so they stay comparable. It steps
// up soon after a bar nears its end and back down only once well clear for a
// while, so it changes rarely: 100 A covers cruise (≈ 50 A a side) and shore
// charging (80 A); a motor at full power (≈ 293 A) needs 300.
export const SCALE_STEPS_A = [50, 100, 200, 300]
export const SCALE_DEFAULT_A = 100
const UP_AT = 0.9
const UP_AFTER_MS = 2000
const DOWN_AT = 0.4 // of the next step down
const DOWN_AFTER_MS = 30000

export class AutoScale {
  maxA = SCALE_DEFAULT_A
  private overSince: number | null = null
  private underSince: number | null = null

  // needA: the longest bar in amps, or null with no data (the scale holds)
  push(at: number, needA: number | null) {
    const i = SCALE_STEPS_A.indexOf(this.maxA)
    const lower = SCALE_STEPS_A[i - 1]
    if (needA != null && needA > this.maxA * UP_AT && i < SCALE_STEPS_A.length - 1) {
      this.underSince = null
      this.overSince ??= at
      if (at - this.overSince >= UP_AFTER_MS) {
        this.maxA = SCALE_STEPS_A.find((s) => needA <= s * UP_AT) ?? SCALE_STEPS_A[SCALE_STEPS_A.length - 1]
        this.overSince = null
      }
    } else if (needA != null && lower != null && needA < lower * DOWN_AT) {
      this.overSince = null
      this.underSince ??= at
      if (at - this.underSince >= DOWN_AFTER_MS) {
        this.maxA = lower
        this.underSince = null
      }
    } else {
      this.overSince = null
      this.underSince = null
    }
    return this.maxA
  }
}
