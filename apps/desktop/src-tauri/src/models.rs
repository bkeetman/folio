use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Book {
    pub id: String, // UUID
    pub file_path: String,
    pub file_hash: Option<String>,
    pub format: String, // "epub", "pdf"
    pub title: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<String>,
    pub language: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
    pub isbn: Option<String>,
    pub cover_path: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Author {
    pub id: i64,
    pub name: String,
}
