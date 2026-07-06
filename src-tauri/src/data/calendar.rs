use chrono::{Datelike, Local, NaiveDate};
use nongli::festivals::Festival;
use nongli::language::{Language, ShortTranslate, Translate};
use nongli::{ChineseDate, SolarTerm};
use serde::Serialize;

#[derive(Serialize)]
pub struct DayInfo {
    pub day: u32,
    pub lunar: String,
    pub is_today: bool,
}

#[derive(Serialize)]
pub struct MonthData {
    pub year: i32,
    pub month: u32,
    pub first_weekday: u32, // 0=周日 ... 6=周六
    pub days: Vec<DayInfo>,
}

/// 一天的农历标签：节日 > 节气 > 农历日（初一日显示月名）
fn lunar_label(date: NaiveDate) -> String {
    let lang = Language::ChineseSimplified;
    let cd = ChineseDate::from_gregorian(&date);
    if let Some(cd) = cd {
        if let Some(f) = Festival::from_chinese_date(cd) {
            return f.short().translate_to_string(lang);
        }
    }
    if let Some(term) = SolarTerm::from_date(&date) {
        return term.short().translate_to_string(lang);
    }
    if let Some(cd) = cd {
        return cd.short().translate_to_string(lang);
    }
    String::new()
}

#[tauri::command]
pub fn calendar_month(year: i32, month: u32) -> Result<MonthData, String> {
    let today = Local::now().date_naive();
    let first = NaiveDate::from_ymd_opt(year, month, 1).ok_or("invalid date")?;
    let first_weekday = first.weekday().num_days_from_sunday();
    let next_first = match month {
        12 => NaiveDate::from_ymd_opt(year + 1, 1, 1),
        m => NaiveDate::from_ymd_opt(year, m + 1, 1),
    }
    .unwrap();
    let days_in_month = next_first.pred_opt().unwrap().day();

    let mut days = Vec::with_capacity(days_in_month as usize);
    for d in 1..=days_in_month {
        let date = NaiveDate::from_ymd_opt(year, month, d).unwrap();
        days.push(DayInfo {
            day: d,
            lunar: lunar_label(date),
            is_today: date == today,
        });
    }
    Ok(MonthData {
        year,
        month,
        first_weekday,
        days,
    })
}
