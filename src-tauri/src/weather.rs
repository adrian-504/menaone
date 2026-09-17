//! Current weather for the office cities on My Day, from MET Norway's
//! Locationforecast API (api.met.no). Free, including for business use, on
//! two conditions this code keeps: requests identify the app, and the data is
//! credited ("Weather: MET Norway", shown under the strip). Only the office
//! coordinates are sent — nothing about the user or their data.

use serde::{Deserialize, Serialize};

const ENDPOINT: &str = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
/// MET Norway asks for an identifying User-Agent with a way to reach the app's makers.
const USER_AGENT: &str = "MENA-One/1.0 (+https://github.com/adrian-504/menaone)";

#[derive(Debug, Deserialize)]
pub struct WeatherPlace {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherNow {
    pub id: String,
    /// Degrees Celsius, rounded.
    pub temperature: i64,
    /// MET Norway symbol, e.g. "partlycloudy_day", "rain".
    pub symbol: String,
}

/// Reads the first forecast step: air temperature now and the symbol for the
/// next hour (falling back to the next six hours).
pub fn parse_forecast(id: &str, body: &serde_json::Value) -> Option<WeatherNow> {
    let first = body.pointer("/properties/timeseries/0/data")?;
    let temperature = first.pointer("/instant/details/air_temperature")?.as_f64()?;
    let symbol = first
        .pointer("/next_1_hours/summary/symbol_code")
        .or_else(|| first.pointer("/next_6_hours/summary/symbol_code"))
        .and_then(|s| s.as_str())
        .unwrap_or("cloudy");
    Some(WeatherNow { id: id.to_string(), temperature: temperature.round() as i64, symbol: symbol.to_string() })
}

/// MET Norway rejects more than four decimals; coordinates outside the globe are refused.
pub fn valid_coordinates(lat: f64, lon: f64) -> Option<(f64, f64)> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return None;
    }
    let round4 = |v: f64| (v * 10_000.0).round() / 10_000.0;
    Some((round4(lat), round4(lon)))
}

/// Weather for each place. A city that fails is left out rather than failing
/// the rest; the strip simply shows its clock without weather.
#[tauri::command]
pub async fn weather_now(places: Vec<WeatherPlace>) -> Result<Vec<WeatherNow>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for place in places.iter().take(8) {
        let Some((lat, lon)) = valid_coordinates(place.lat, place.lon) else { continue };
        let Ok(resp) = client.get(ENDPOINT).query(&[("lat", lat), ("lon", lon)]).send().await else { continue };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(body) = resp.json::<serde_json::Value>().await else { continue };
        if let Some(now) = parse_forecast(&place.id, &body) {
            out.push(now);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_temperature_and_next_hour_symbol() {
        let body = serde_json::json!({ "properties": { "timeseries": [ { "time": "2026-09-17T12:00:00Z", "data": {
            "instant": { "details": { "air_temperature": 36.6 } },
            "next_1_hours": { "summary": { "symbol_code": "clearsky_day" } },
            "next_6_hours": { "summary": { "symbol_code": "fair_day" } }
        } } ] } });
        assert_eq!(parse_forecast("ruh", &body), Some(WeatherNow { id: "ruh".into(), temperature: 37, symbol: "clearsky_day".into() }));
    }

    #[test]
    fn falls_back_to_the_six_hour_symbol_and_skips_empty_forecasts() {
        let body = serde_json::json!({ "properties": { "timeseries": [ { "data": {
            "instant": { "details": { "air_temperature": -0.4 } },
            "next_6_hours": { "summary": { "symbol_code": "lightrain" } }
        } } ] } });
        let now = parse_forecast("bcn", &body).unwrap();
        assert_eq!((now.temperature, now.symbol.as_str()), (0, "lightrain"));
        assert_eq!(parse_forecast("bcn", &serde_json::json!({ "properties": { "timeseries": [] } })), None);
    }

    #[test]
    fn coordinates_are_rounded_and_checked() {
        assert_eq!(valid_coordinates(41.387_412, 2.168_568), Some((41.3874, 2.1686)));
        assert_eq!(valid_coordinates(91.0, 0.0), None);
        assert_eq!(valid_coordinates(0.0, -181.0), None);
    }
}
