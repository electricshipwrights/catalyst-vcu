//! Replays tests/fixtures/range.json (written by `pnpm parity` in ui/ from the
//! prototype's TypeScript): each case through `range_view` and `chart_paths`.

use serde_json::{Value, json};
use vcu_core::range::{RangeInput, RangeView, RangeWindow, chart_paths, range_view, speed_for};

fn same(a: f64, b: &Value) -> bool {
    let b = b.as_f64().unwrap();
    (a - b).abs() <= 1e-9 * a.abs().max(1.0)
}

fn input(v: &Value) -> RangeInput {
    RangeInput {
        soc: v["soc"].as_f64().unwrap(),
        house_a: v["houseA"].as_f64().unwrap(),
        propulsion_a: v["propulsionA"].as_f64().unwrap(),
        solar_a: v["solarA"].as_f64().unwrap(),
        mppts: v["mppts"].as_f64().unwrap(),
        shore: v["shore"].as_bool().unwrap(),
        charger_a: v["chargerA"].as_f64().unwrap(),
    }
}

/// The view's text and times, as the fixture writes them.
fn texts(v: &RangeView) -> Value {
    json!({
        "basis": format!("{:?}", v.basis).to_lowercase(),
        "end": v.end,
        "beyond": v.beyond,
        "reserveIn": v.reserve_in,
        "reserveAt": v.reserve_at,
        "noSunIn": v.no_sun_in,
        "noSunAt": v.no_sun_at,
        "ticks": v.ticks.iter().map(|t| json!({"at": t.at, "label": t.label})).collect::<Vec<_>>(),
        "midnights": v.midnights,
        "emptyAt": v.projection.empty_at,
        "emptyBatteryOnlyAt": v.projection.empty_battery_only_at,
        "points": v.projection.points.len(),
        "dockFull": v.dock.as_ref().map(|d| d.full.clone()),
    })
}

/// JSON equality with numbers compared by value (Rust writes 64.0 where JS wrote 64).
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_json(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

#[test]
fn matches_the_typescript_prototype() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/range.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 30);
    for (i, case) in cases.iter().enumerate() {
        let inp = &case["input"];
        let out = &case["out"];
        let sides: Vec<RangeInput> = inp["sides"].as_array().unwrap().iter().map(input).collect();
        let window = match inp["w"].as_str().unwrap() {
            "today" => RangeWindow::Today,
            _ => RangeWindow::Day,
        };
        let now = inp["now"].as_f64().unwrap();
        let v = range_view(
            &sides,
            inp["planKn"].as_f64(),
            window,
            now,
            inp["offsetMin"].as_f64().unwrap(),
        )
        .unwrap();

        assert!(same(v.kn, &out["kn"]), "case {i} kn: rust {}, typescript {}", v.kn, out["kn"]);
        let p = &out["projection"];
        assert!(
            same(v.projection.range_nm, &p["rangeNm"]),
            "case {i} range: rust {}, typescript {}",
            v.projection.range_nm,
            p["rangeNm"]
        );
        let want = json!({
            "basis": out["basis"],
            "end": out["end"],
            "beyond": out["beyond"],
            "reserveIn": out["reserveIn"],
            "reserveAt": out["reserveAt"],
            "noSunIn": out["noSunIn"],
            "noSunAt": out["noSunAt"],
            "ticks": out["ticks"],
            "midnights": out["midnights"],
            "emptyAt": p["emptyAt"],
            "emptyBatteryOnlyAt": p["emptyBatteryOnlyAt"],
            "points": p["points"],
            "dockFull": out["dock"].get("full").cloned().unwrap_or(Value::Null),
        });
        let got = texts(&v);
        assert!(same_json(&got, &want), "case {i}:\nrust       {got}\ntypescript {want}");
        match (&v.dock, out["dock"].get("nm")) {
            (None, None) => {}
            (Some(d), Some(nm)) => match d.nm {
                Some(n) => assert!(same(n, nm), "case {i} dock nm: rust {n}, typescript {nm}"),
                None => assert!(nm.is_null(), "case {i} dock nm: rust none, typescript {nm}"),
            },
            (d, nm) => panic!("case {i} dock: rust {d:?}, typescript {nm:?}"),
        }

        let paths = chart_paths(&v, now, 276.0, 88.0);
        for (name, got) in [
            ("withSolar", &paths.with_solar),
            ("batteryOnly", &paths.battery_only),
            ("solar", &paths.solar),
        ] {
            let want = out["paths"][name].as_str().unwrap();
            assert_eq!(got, want, "case {i} {name} path");
        }
    }

    for s in fixture["speeds"].as_array().unwrap() {
        let a = s[0].as_f64().unwrap();
        assert!(same(speed_for(a), &s[1]), "speed for {a} A");
    }
}
