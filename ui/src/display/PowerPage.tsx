import { Fragment, useEffect, useRef, useState } from "react";
import type { BusName } from "../../shared/bus";
import { AutoScale } from "./autoScale";
import { SHORE_SLOT_A, SOLAR_SLOT_A, powerView, type PowerView } from "./power";
import { useInputView, useSmoothing } from "./settings";
import { useSide } from "./useSide";

const TRACK_W = 124;
const TRACK_X: Record<BusName, number> = { port: 10, stbd: 186 };
const INPUT_Y = 148;
const LOAD_Y = 170;
// Input per source: shore at the inner end, then MPPT 1–4
const SLOTS = 5;
const SLOT_GAP = 4;
const SLOT_W = (TRACK_W - (SLOTS - 1) * SLOT_GAP) / SLOTS;
const SHORE = -1;

type SegKind = "solar" | "shore" | "base" | "heater" | "inverter" | "propulsion";
type Seg = { from: number; to: number; kind: SegKind };

// A scale change eases over this long, so the bars grow or shrink smoothly
// instead of jumping
const SCALE_EASE_MS = 500;

type Ease = { from: number; to: number; start: number };
const eased = ({ from, to, start }: Ease, now: number) => {
  const t = Math.min(1, (now - start) / SCALE_EASE_MS);
  return from + (to - from) * (1 - (1 - t) ** 3);
};

// The scale the bars are drawn at: `target`, eased to when it changes, with a
// frame drawn each animation frame until it's there
function useEasedScale(target: number) {
  const ease = useRef<Ease>({ from: target, to: target, start: 0 }).current;
  const [, redraw] = useState(0);
  const now = performance.now();
  if (target !== ease.to) Object.assign(ease, { from: eased(ease, now), to: target, start: now });
  const shown = eased(ease, now);
  useEffect(() => {
    if (shown === ease.to) return;
    const frame = requestAnimationFrame(() => redraw((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  });
  return shown;
}

// Amps to pixels along a track whose full scale is `max`
const px = (a: number, max: number) =>
  (Math.min(Math.max(a, 0), max) / max) * TRACK_W;

// Parts stacked end to end from the inner end
function stack(parts: [SegKind, number][]): Seg[] {
  let at = 0;
  return parts.map(([kind, a]) => ({ from: at, to: (at += a), kind }));
}

function inputSegs(v: PowerView): Seg[] {
  if (!v.online) return [];
  return stack([["shore", v.chargerA ?? 0], ["solar", v.solarA]]);
}

// The house load stays put at the inner end (base, then steady, then
// intermittent); the motor, which swings with the throttle, goes outermost
function loadSegs(v: PowerView): Seg[] {
  if (!v.online) return [];
  return stack([
    ["base", v.baseA],
    ["heater", v.heaterA],
    ["inverter", v.inverterA],
    ["propulsion", v.propulsionA],
  ]);
}

// max: the track's full scale in amps
function Track({
  side,
  top,
  segs,
  max,
}: {
  side: BusName;
  top: number;
  segs: Seg[];
  max: number;
}) {
  return (
    <div
      className={`track track-${side}`}
      style={{ top, left: TRACK_X[side], width: TRACK_W }}
    >
      {segs.map((s) => {
        // A 1px gap where one part meets the next
        const gap = s.from > 0 ? 1 : 0;
        const offset = px(s.from, max) + gap;
        const width = px(s.to, max) - offset;
        if (width <= 0) return null;
        return (
          <div
            key={s.kind}
            className={`seg seg-${s.kind}`}
            style={
              side === "port"
                ? { right: offset, width }
                : { left: offset, width }
            }
          />
        );
      })}
    </div>
  );
}

// Scale ends only: full scale at the outer end of each track, 0 at the inner end
function Ticks({ side, max }: { side: BusName; max: number }) {
  const x = TRACK_X[side];
  const labels = side === "port" ? [max, 0] : [0, max];
  return (
    <>
      {labels.map((a, i) => (
        <span
          key={a}
          className="tick"
          style={{
            left: x + TRACK_W * i,
            transform: `translateX(${-100 * i}%)`,
          }}
        >
          {a}
        </span>
      ))}
    </>
  );
}

// Slot n from the inner end, in the same place on both sides
const slotX = (side: BusName, n: number) =>
  side === "port"
    ? TRACK_X.port + TRACK_W - SLOT_W - n * (SLOT_W + SLOT_GAP)
    : TRACK_X.stbd + n * (SLOT_W + SLOT_GAP);

// One slot for shore under a plug, then one per MPPT, numbered above. In use
// on this side: a track filled on that source's own scale. Allocated
// elsewhere, unplugged or no data: a dashed outline.
function InputSlots({ side, v }: { side: BusName; v: PowerView }) {
  return (
    <>
      {[SHORE, 0, 1, 2, 3].map((i) => {
        const shore = i === SHORE;
        const a = !v.online ? null : shore ? v.chargerA : v.mpptA[i];
        const max = shore ? SHORE_SLOT_A : SOLAR_SLOT_A;
        const x = slotX(side, i + 1);
        const fill = a == null ? 0 : (Math.min(a, max) / max) * SLOT_W;
        return (
          <Fragment key={i}>
            <span
              className={`tick slot-num ${a == null ? "away" : ""}`}
              style={{ top: INPUT_Y - 13, left: x, width: SLOT_W }}
            >
              {shore ? <ShoreIcon /> : i + 1}
            </span>
            <div
              className={a == null ? "slot away" : "track slot"}
              style={{ top: INPUT_Y, left: x, width: SLOT_W }}
            >
              {fill > 0 && (
                <div
                  className={`seg seg-${shore ? "shore" : "solar"}`}
                  style={side === "port" ? { right: 0, width: fill } : { left: 0, width: fill }}
                />
              )}
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export function ShoreIcon() {
  return (
    <svg
      className="shore-icon"
      width="9"
      height="11"
      viewBox="0 0 9 11"
      aria-label="shore power"
    >
      <path d="M2 0 H3.2 V3 H5.8 V0 H7 V3 H9 V5.5 C9 7.2 7.8 8.4 6.2 8.6 V11 H2.8 V8.6 C1.2 8.4 0 7.2 0 5.5 V3 H2 Z" />
    </svg>
  );
}

function FlowIcon({ charging }: { charging: boolean }) {
  return charging ? (
    <svg
      className="flow-icon charging"
      width="9"
      height="13"
      viewBox="0 0 9 13"
      aria-label="charging"
    >
      <path d="M5.5 0 L0 7.5 H4 L3 13 L9 5 H5 Z" />
    </svg>
  ) : (
    <svg
      className="flow-icon"
      width="10"
      height="12"
      viewBox="0 0 10 12"
      aria-label="discharging"
    >
      <path d="M3.5 0 H6.5 V6.5 H10 L5 12 L0 6.5 H3.5 Z" />
    </svg>
  );
}

function Footer({ side, v }: { side: BusName; v: PowerView }) {
  if (!v.online) {
    return (
      <div className={`footer footer-${side} offline`}>
        <div className="net">NO DATA</div>
        <div className="detail">BMS silent</div>
      </div>
    );
  }
  return (
    <div className={`footer footer-${side}`}>
      <div className="net">{signed(v.netA)} A</div>
      {/* In (solar + charger) and out, signed so they need no labels; on the inboard side */}
      <div className="detail flows">
        <span>{signed(v.inA)}</span>
        <span>{signed(-v.outA)}</span>
      </div>
    </div>
  );
}

// "4:00 to empty": the time stands out, the rest is quieter
function Eta({ side, text }: { side: BusName; text: string | null }) {
  const [, time, rest] = text?.match(/^(.*?)( to .*)?$/) ?? [null, "--", ""];
  return (
    <div className={`eta side-${side}`}>
      <span className="eta-time">{time}</span>
      {rest}
    </div>
  );
}

function SideHead({ side, v }: { side: BusName; v: PowerView }) {
  // Charging or discharging, then shore power when plugged in, on the inboard
  // side of the SOC (mirrored for starboard)
  const flow = v.online && v.netA !== 0 && <FlowIcon charging={v.netA > 0} />;
  const shore = v.online && v.shore && <ShoreIcon />;
  return (
    <>
      <div className={`side-label side-${side}`}>{side === "port" ? "PORT" : "STBD"}</div>
      <div className={`soc side-${side} ${v.online ? "" : "offline"}`}>
        {side === "stbd" && shore}
        {side === "stbd" && flow}
        {v.online ? Math.round(v.soc) : "--"}
        <span className="pct">%</span>
        {side === "port" && flow}
        {side === "port" && shore}
      </div>

      <Eta side={side} text={v.online ? v.eta : null} />
    </>
  );
}

export function PowerPage() {
  const smoothing = useSmoothing();
  const port = powerView(useSide("port"), smoothing);
  const stbd = powerView(useSide("stbd"), smoothing);
  // Per source: a slot each for shore and the MPPTs; combined: one bar on the load scale
  const combined = useInputView() === "combined";
  // The scale fits the longest bar on either side
  const autoScale = useRef(new AutoScale()).current;
  const online = [port, stbd].flatMap((v) => (v.online ? [v] : []));
  const need = online.length ? Math.max(...online.map((v) => (combined ? Math.max(v.outA, v.inA) : v.outA))) : null;
  const max = autoScale.push(performance.now(), need);
  // The bars ease to a new scale; its labels change at once
  const shown = useEasedScale(max);
  return (
    <div className="page power">
      <SideHead side="port" v={port} />
      <SideHead side="stbd" v={stbd} />

      {combined ? (
        <>
          {/* The input's axis is above its track */}
          <div className="ticks" style={{ top: INPUT_Y - 13 }}>
            <Ticks side="port" max={max} />
            <Ticks side="stbd" max={max} />
          </div>
          <Track side="port" top={INPUT_Y} segs={inputSegs(port)} max={shown} />
          <Track side="stbd" top={INPUT_Y} segs={inputSegs(stbd)} max={shown} />
        </>
      ) : (
        <>
          <InputSlots side="port" v={port} />
          <InputSlots side="stbd" v={stbd} />
        </>
      )}
      <div className="row-label" style={{ top: INPUT_Y }}>
        INPUT
      </div>

      <Track side="port" top={LOAD_Y} segs={loadSegs(port)} max={shown} />
      <Track side="stbd" top={LOAD_Y} segs={loadSegs(stbd)} max={shown} />
      <div className="row-label" style={{ top: LOAD_Y }}>
        LOAD
      </div>

      <div className="ticks">
        <Ticks side="port" max={max} />
        <Ticks side="stbd" max={max} />
      </div>

      <Footer side="port" v={port} />
      <Footer side="stbd" v={stbd} />
    </div>
  );
}
