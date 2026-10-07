//! Replays tests/fixtures/parity.json (written by `pnpm parity` in ui/ from the
//! prototype's TypeScript) and checks every 10 Hz reading and power view.

use serde_json::Value;
use vcu_core::{PowerView, Side, Smoothing, power_view};

fn hex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn opt(v: &Value) -> Option<f64> {
    v.as_f64()
}

fn same(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => (a - b).abs() <= 1e-9 * a.abs().max(1.0),
        (a, b) => a == b,
    }
}

/// JSON equality with numbers compared by value (Rust writes 64.0 where JS wrote 64).
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_json(a, b))
        }
        _ => a == b,
    }
}

fn view_json(v: Option<PowerView>) -> Value {
    match v {
        None => Value::Null,
        Some(v) => serde_json::json!([
            v.soc,
            v.shore,
            v.solar_a,
            v.in_a,
            v.out_a,
            v.propulsion_a,
            v.net_a,
            v.eta.text()
        ]),
    }
}

#[test]
fn matches_the_typescript_prototype() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/parity.json")).unwrap();
    let frames = fixture["frames"].as_array().unwrap();
    let ticks = fixture["ticks"].as_array().unwrap();
    assert!(ticks.len() > 1000);

    let mut side = Side::default();
    let mut cursor = 0;
    for tick in ticks {
        let now = tick[0].as_f64().unwrap();
        while cursor < frames.len() && frames[cursor][0].as_f64().unwrap() <= now {
            let f = &frames[cursor];
            let data = hex(f[3].as_str().unwrap());
            side.ingest(
                f[1].as_u64().unwrap() as u32,
                f[2].as_bool().unwrap(),
                &data,
                f[0].as_f64().unwrap(),
            );
            cursor += 1;
        }
        let reading = side.tick(now);

        match (&reading, tick[1].as_array()) {
            (None, None) => {}
            (Some(r), Some(want)) => {
                let (c, s) = (r.live.currents, r.smooth);
                let got = [
                    c.solar_a,
                    c.charger_a,
                    c.propulsion_a,
                    Some(c.house_a),
                    s.solar_a,
                    s.charger_a,
                    s.propulsion_a,
                    Some(s.house_a),
                    r.eta_net_a,
                ];
                for (i, (g, w)) in got.iter().zip(want).enumerate() {
                    assert!(
                        same(*g, opt(w)),
                        "t={now} reading[{i}]: rust {g:?}, typescript {w}"
                    );
                }
            }
            (r, w) => panic!("t={now}: online mismatch, rust {r:?}, typescript {w:?}"),
        }

        for (smoothing, col) in [(Smoothing::Smooth, 2), (Smoothing::Instant, 3)] {
            let got = view_json(power_view(reading.as_ref(), smoothing));
            assert!(
                same_json(&got, &tick[col]),
                "t={now} {smoothing:?} view: rust {got}, typescript {}",
                tick[col]
            );
        }
    }
    assert_eq!(cursor, frames.len());
}
