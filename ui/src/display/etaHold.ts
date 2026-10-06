const SETTLE_MS = 1000
const BAND_MIN_A = 0.75
const BAND_FRACTION = 0.1

export class EtaHold {
  private ref: number | null = null
  private changedAt = 0
  private sum = 0
  private count = 0
  private settled = false
  private held: number | null = null

  push(at: number, netA: number) {
    if (this.ref == null || Math.abs(netA - this.ref) > Math.max(BAND_MIN_A, Math.abs(this.ref) * BAND_FRACTION)) {
      this.ref = netA
      this.changedAt = at
      this.sum = 0
      this.count = 0
      this.settled = false
    }
    if (!this.settled) {
      this.sum += netA
      this.count++
      if (at - this.changedAt >= SETTLE_MS) {
        this.held = this.sum / this.count
        this.settled = true
      } else if (this.held != null && Math.sign(this.held) !== Math.sign(netA)) {
        this.held = null
      }
    }
    return this.held
  }

  clear() {
    this.ref = null
    this.held = null
    this.settled = false
  }
}
