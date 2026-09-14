//! Rate-card pricing on the Rust side — the same rules as src/lib/pricing.ts:
//! how a service's proposal rows work (employee tranches, workforce
//! categories, accountancy rows, staff-type percentages, countries), and the
//! words used to match a row to a line in a template's fee table.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tranche {
    pub label: String,
    pub no_comm_min: Option<f64>,
    pub no_comm_max: Option<f64>,
    pub comm_min: Option<f64>,
    pub comm_max: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Percent {
    pub min: f64,
    pub standard: f64,
    pub max: f64,
    #[serde(default)]
    pub basis: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PresetRow {
    pub label: String,
    #[serde(default)]
    pub min: f64,
    #[serde(default)]
    pub standard: f64,
    #[serde(default)]
    pub max: f64,
    #[serde(default)]
    pub percent: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    #[serde(default)]
    pub has_tranches: bool,
    #[serde(default)]
    pub tranches: Vec<Tranche>,
    #[serde(default)]
    pub rows: Vec<PresetRow>,
    #[serde(default)]
    pub per_country: bool,
    #[serde(default)]
    pub percent: Option<Percent>,
    #[serde(default)]
    pub no_comm_min: Option<f64>,
    #[serde(default)]
    pub no_comm_max: Option<f64>,
    #[serde(default)]
    pub standard: Option<f64>,
    #[serde(default)]
    pub show_bands: Option<usize>,
}

impl Card {
    pub fn from_json(v: &serde_json::Value) -> Option<Card> {
        serde_json::from_value(v.clone()).ok()
    }

    /// The usual price of a card priced as one figure (Constitution 55,000).
    pub fn standard_price(&self) -> Option<f64> {
        match (self.no_comm_min, self.no_comm_max) {
            (Some(min), Some(max)) => Some(self.standard.filter(|s| *s >= min && *s <= max).unwrap_or(((min + max) / 2.0 / 50.0).round() * 50.0)),
            _ => self.standard,
        }
    }

    /// Labels of the rows this card suggests, to recognise its fee table rows.
    pub fn preset_labels(&self) -> Vec<String> {
        self.tranches.iter().map(|t| t.label.clone()).chain(self.rows.iter().map(|r| r.label.clone())).collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowKind {
    Tranche,
    Category,
    Row,
    Percent,
    Country,
}

/// "1–5 employees" → (1, 5); "25 employees and below" → (1, 25).
pub fn parse_range(label: &str) -> Option<(i64, i64)> {
    static RANGE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static BELOW: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let range = RANGE.get_or_init(|| regex::Regex::new(r"(\d+)\s*[-–]\s*(\d+)").expect("regex"));
    if let Some(c) = range.captures(label) {
        return Some((c[1].parse().ok()?, c[2].parse().ok()?));
    }
    let below = BELOW.get_or_init(|| regex::Regex::new(r"(?i)(\d+)\s*employees?\s*and\s*below").expect("regex"));
    below.captures(label).and_then(|c| Some((1, c[1].parse().ok()?)))
}

pub fn tranche_label(from: Option<i64>, to: Option<i64>) -> String {
    match (from, to) {
        (Some(f), Some(t)) => format!("{f}–{t} employees"),
        (None, Some(t)) => format!("Up to {t} employees"),
        (Some(f), None) => format!("{f}+ employees"),
        _ => String::new(),
    }
}

pub fn row_kind(card: &Card) -> Option<RowKind> {
    if card.per_country {
        return Some(RowKind::Country);
    }
    if !card.rows.is_empty() {
        return Some(if card.rows.iter().all(|r| r.percent) { RowKind::Percent } else { RowKind::Row });
    }
    if card.has_tranches && !card.tranches.is_empty() {
        return Some(if card.tranches.iter().all(|t| parse_range(&t.label).is_some()) { RowKind::Tranche } else { RowKind::Category });
    }
    None
}

const IGNORED: &[&str] = &["and", "the", "of", "employee", "employees", "tranche", "mo"];

pub fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .replace('&', " and ")
        .replace(['–', '—'], "-")
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '%' || c == '-'))
        .flat_map(|w| {
            // "Non-Nationalized" also reads as "non" + "nationalized".
            let parts: Vec<String> = w.split('-').filter(|p| !p.is_empty()).map(str::to_string).collect();
            std::iter::once(w.to_string()).chain(if parts.len() > 1 { parts } else { vec![] })
        })
        .filter(|w| !w.is_empty() && w != "-" && !IGNORED.contains(&w.as_str()))
        .collect()
}

/// Every word of `label` appears in `text` ("Nationalized (Engineers & Managers)"
/// matches "Professional Nationalized Employee (Engineers and Managers)").
pub fn names(label: &str, text: &str) -> bool {
    let lw = words(label);
    let tw = words(text);
    !lw.is_empty() && lw.iter().all(|w| tw.contains(w))
}

/// Like `names`, but a row for "Non-Nationalized" never counts as "Nationalized".
pub fn names_exactly(label: &str, text: &str) -> bool {
    if !names(label, text) {
        return false;
    }
    let lw = words(label);
    let tw = words(text);
    !(tw.contains(&"non".to_string()) && !lw.contains(&"non".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rate_cards_like_the_app() {
        let tr = |label: &str| Tranche { label: label.into(), no_comm_min: Some(1.0), no_comm_max: Some(2.0), ..Default::default() };
        let admin = Card { has_tranches: true, tranches: vec![tr("1–5 employees"), tr("6–15 employees")], ..Default::default() };
        let workforce = Card { has_tranches: true, tranches: vec![tr("Nationalized (Engineers & Managers)")], ..Default::default() };
        assert_eq!(row_kind(&admin), Some(RowKind::Tranche));
        assert_eq!(row_kind(&workforce), Some(RowKind::Category));
        assert_eq!(row_kind(&Card { per_country: true, ..Default::default() }), Some(RowKind::Country));
        assert_eq!(parse_range("Tranche 1 – PRO Services (25 Employees and Below)"), Some((1, 25)));
        assert_eq!(Card { no_comm_min: Some(45000.0), no_comm_max: Some(66000.0), standard: Some(55000.0), ..Default::default() }.standard_price(), Some(55000.0));
        assert!(names("Non-Nationalized (Unskilled)", "Professional Non-Nationalized Employee (Unskilled)"));
        assert!(!names_exactly("Nationalized (Engineers & Managers)", "Professional Non-Nationalized Employee (Engineers)"));
        assert!(names_exactly("Nationalized (Engineers & Managers)", "Professional Nationalized Employee (Engineers & Managers)"));
        assert!(names("Professional Staff", "Professional Staff Only"));
    }
}
