import { useState } from "react";
import { RESERVE_PCT } from "./power";
import {
  WINDOWS,
  chartPaths,
  localOffsetMin,
  rangeView,
  socY,
  stepSpeed,
  type RangeInput,
  type RangeWindow,
  type SpeedBasis,
} from "./range";
import { useSide, type SideReading } from "./useSide";

// The time axis sits just under the chart, its labels on the power view's
// footer baseline, so both views have the same bottom margin
const CHART = { x: 10, y: 125, w: 276, h: 88 };
const AXIS_Y = CHART.y + CHART.h + 6;
const WINDOW_LABELS: Record<RangeWindow, string> = { today: "TODAY", "24 hours": "24 HOURS" };
const BASIS_LABELS: Record<SpeedBasis, string> = { now: "NOW", cruise: "CRUISE", plan: "PLAN" };
// Gridlines up the side: full, half, and the reserve
const LEVELS = [100, 50, RESERVE_PCT];

// The smoothed currents, like the power view's bars
function rangeInput(r: SideReading): RangeInput[] {
  if (!r.online) return [];
  const c = r.smooth;
  return [
    {
      soc: r.soc,
      houseA: Math.max(0, c.houseA),
      propulsionA: Math.max(0, c.propulsionA ?? 0),
      solarA: Math.max(0, c.solarA ?? 0),
      mppts: r.mppts,
    },
  ];
}

// A time with its label above, like the side labels over the SOC
function When({ at, label, text }: { at: "center" | "right"; label: string; text: string }) {
  return (
    <div className={`when when-${at}`}>
      <div className="when-label">{label}</div>
      <div className="when-time">{text}</div>
    </div>
  );
}

// Range view (button B): how far at a speed before the first side reaches
// the reserve, with and without the sun, over today or the next 24 hours
export function RangePage() {
  const port = useSide("port");
  const stbd = useSide("stbd");
  // A speed picked here; null follows the boat
  const [planKn, setPlanKn] = useState<number | null>(null);
  const [win, setWin] = useState<RangeWindow>("today");
  const now = Date.now();
  const v = rangeView([...rangeInput(port), ...rangeInput(stbd)], planKn, win, now, localOffsetMin(now));

  if (!v) {
    return (
      <div className="page range offline">
        <div className="net">NO DATA</div>
        <div className="detail">BMS silent</div>
      </div>
    );
  }

  const paths = chartPaths(v, now, CHART.w, CHART.h);
  const span = v.end - now;
  return (
    <div className="page range">
      <button className="step" style={{ left: 10 }} onClick={() => setPlanKn(stepSpeed(v.kn, -1))}>
        −
      </button>
      {/* Tapping the speed goes back to following the boat */}
      <button className="speed" onClick={() => setPlanKn(null)}>
        <span className="kn">{v.kn.toFixed(1)} kn</span>
        <span className="basis">{BASIS_LABELS[v.basis]}</span>
      </button>
      <button className="step" style={{ left: 110 }} onClick={() => setPlanKn(stepSpeed(v.kn, 1))}>
        +
      </button>

      <div className="windows">
        {WINDOWS.map((w) => (
          <button key={w} className={w === win ? "on" : ""} onClick={() => setWin(w)}>
            {WINDOW_LABELS[w]}
          </button>
        ))}
      </div>

      <div className="range-nm">
        {Math.round(v.projection.rangeNm)}
        {v.beyond ? "+" : ""}
        <span className="unit"> nm</span>
      </div>
      {/* When the first side reaches the reserve, with the sun and without */}
      <When at="center" label="RESERVE" text={v.reserve} />
      <When at="right" label="W/O SUN" text={v.noSun} />

      <svg className="chart" style={{ left: CHART.x, top: CHART.y }} width={CHART.w} height={CHART.h}>
        <path className="sun" d={paths.solar} />
        {LEVELS.map((soc) => (
          <line key={soc} className={soc === RESERVE_PCT ? "reserve" : "grid"} x1={0} x2={CHART.w} y1={socY(soc, CHART.h)} y2={socY(soc, CHART.h)} />
        ))}
        <path className="battery-only" d={paths.batteryOnly} />
        <path className="with-solar" d={paths.withSolar} />
      </svg>
      {LEVELS.map((soc) => (
        <span key={soc} className="tick level" style={{ top: CHART.y + socY(soc, CHART.h) - 5 }}>
          {soc}
        </span>
      ))}

      <span className="tick" style={{ top: AXIS_Y, left: CHART.x }}>
        NOW
      </span>
      {v.ticks.map((t) => (
        <span
          key={t.at}
          className="tick"
          style={{ top: AXIS_Y, left: CHART.x + ((t.at - now) / span) * CHART.w, transform: "translateX(-50%)" }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}
