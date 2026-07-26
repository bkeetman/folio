use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{Map, Value};
use uuid::Uuid;

pub(crate) const CHANGE_TYPE: &str = "folio_metadata";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FolioMetadataProposal {
    version: u8,
    item_id: String,
    changes: Map<String, Value>,
    expected: Map<String, Value>,
    source: String,
    confidence: f64,
    reason: String,
    overwrite: bool,
}

pub(crate) fn desktop_representation(
    change_type: &str,
    changes_json: Option<String>,
) -> Result<(String, Option<String>), String> {
    if change_type != CHANGE_TYPE {
        return Ok((change_type.to_string(), changes_json));
    }
    let raw = changes_json.ok_or_else(|| "Missing Folio metadata payload".to_string())?;
    let proposal = parse_proposal(&raw)?;
    let visible = serde_json::json!({
        "itemId": proposal.item_id,
        "metadata": proposal.changes,
    });
    Ok(("item_metadata".to_string(), Some(visible.to_string())))
}

pub(crate) fn apply_proposal(
    conn: &Connection,
    change_id: &str,
    file_id: &str,
    changes_json: &str,
    now: i64,
) -> Result<(), String> {
    let proposal = parse_proposal(changes_json)?;
    validate_proposal(&proposal)?;
    let file_item_id = conn
        .query_row(
            "SELECT item_id FROM files WHERE id = ?1 LIMIT 1",
            params![file_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("File not found for metadata proposal: {file_id}"))?;
    if file_item_id != proposal.item_id {
        return Err("Metadata proposal does not match its file record".to_string());
    }

    let transaction = conn
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    for (field, value) in &proposal.changes {
        let expected = proposal
            .expected
            .get(field)
            .ok_or_else(|| format!("Metadata proposal is missing expected value for {field}"))?;
        let current = current_value(&transaction, &proposal.item_id, field)?;
        if !metadata_values_equal(&current, expected) {
            return Err(format!(
                "Metadata changed since this proposal was created: {field}"
            ));
        }
        if !proposal.overwrite && has_metadata_value(&current) {
            return Err(format!("Metadata field is already populated: {field}"));
        }
        apply_field(
            &transaction,
            &proposal.item_id,
            field,
            value,
            &proposal.source,
            proposal.confidence,
            now,
        )?;
    }
    transaction
        .execute(
            "UPDATE pending_changes SET status = 'applied', applied_at = ?1, error = NULL WHERE id = ?2 AND status = 'pending'",
            params![now, change_id],
        )
        .map_err(|err| err.to_string())?;
    transaction.commit().map_err(|err| err.to_string())
}

fn parse_proposal(raw: &str) -> Result<FolioMetadataProposal, String> {
    let proposal: FolioMetadataProposal = serde_json::from_str(raw)
        .map_err(|err| format!("Invalid Folio metadata proposal: {err}"))?;
    if proposal.version != 1 {
        return Err(format!(
            "Unsupported Folio metadata proposal version: {}",
            proposal.version
        ));
    }
    if proposal.item_id.trim().is_empty() {
        return Err("Folio metadata proposal is missing an item id".to_string());
    }
    if proposal.changes.is_empty() {
        return Err("Folio metadata proposal has no changes".to_string());
    }
    if proposal.source.trim().is_empty() || proposal.reason.trim().is_empty() {
        return Err("Folio metadata proposal is missing provenance".to_string());
    }
    if !proposal.confidence.is_finite() || proposal.confidence < 0.0 || proposal.confidence > 1.0 {
        return Err("Folio metadata proposal confidence must be between 0 and 1".to_string());
    }
    Ok(proposal)
}

const METADATA_FIELDS: [&str; 8] = [
    "title",
    "authors",
    "publishedYear",
    "language",
    "isbn",
    "series",
    "seriesIndex",
    "description",
];

fn validate_proposal(proposal: &FolioMetadataProposal) -> Result<(), String> {
    for field in proposal.changes.keys().chain(proposal.expected.keys()) {
        if !METADATA_FIELDS.contains(&field.as_str()) {
            return Err(format!("Unsupported Folio metadata field: {field}"));
        }
    }
    for (field, value) in &proposal.changes {
        if !proposal.expected.contains_key(field) {
            return Err(format!(
                "Metadata proposal is missing expected value for {field}"
            ));
        }
        match field.as_str() {
            "authors" => {
                let authors = value
                    .as_array()
                    .ok_or_else(|| "Metadata authors must be an array".to_string())?;
                if authors.is_empty()
                    || authors.iter().any(|author| {
                        author
                            .as_str()
                            .map_or(true, |name| normalize_author_name(name).is_empty())
                    })
                {
                    return Err("Metadata authors must contain non-empty names".to_string());
                }
            }
            "publishedYear" => {
                let year = value
                    .as_i64()
                    .ok_or_else(|| "Published year must be an integer".to_string())?;
                if !(1000..=9999).contains(&year) {
                    return Err("Published year must be a four-digit year".to_string());
                }
            }
            "seriesIndex" => {
                let index = value
                    .as_f64()
                    .ok_or_else(|| "Series index must be a number".to_string())?;
                if !index.is_finite() || index <= 0.0 {
                    return Err("Series index must be a positive number".to_string());
                }
            }
            _ => {
                if value.as_str().map_or(true, |text| text.trim().is_empty()) {
                    return Err(format!("Metadata field {field} must be non-empty text"));
                }
            }
        }
    }
    Ok(())
}

fn current_value(conn: &Connection, item_id: &str, field: &str) -> Result<Value, String> {
    match field {
        "authors" => {
            let mut stmt = conn
                .prepare(
                    "SELECT authors.name FROM item_authors JOIN authors ON authors.id = item_authors.author_id WHERE item_authors.item_id = ?1 ORDER BY COALESCE(item_authors.ord, 0), authors.name COLLATE NOCASE",
                )
                .map_err(|err| err.to_string())?;
            let rows = stmt
                .query_map(params![item_id], |row| row.get::<_, String>(0))
                .map_err(|err| err.to_string())?;
            let authors = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|err| err.to_string())?;
            Ok(Value::Array(
                authors.into_iter().map(Value::String).collect(),
            ))
        }
        "isbn" => {
            let isbn = conn
                .query_row(
                    "SELECT value FROM identifiers WHERE item_id = ?1 AND upper(type) IN ('ISBN10', 'ISBN13', 'OTHER') ORDER BY CASE WHEN upper(type) = 'ISBN13' THEN 0 WHEN upper(type) = 'ISBN10' THEN 1 ELSE 2 END, created_at DESC LIMIT 1",
                    params![item_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|err| err.to_string())?;
            Ok(isbn.map(Value::String).unwrap_or(Value::Null))
        }
        "title" | "language" | "series" | "description" => {
            let column = scalar_column(field)?;
            let value = conn
                .query_row(
                    &format!("SELECT {column} FROM items WHERE id = ?1"),
                    params![item_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
                .map_err(|err| err.to_string())?
                .ok_or_else(|| format!("Book not found: {item_id}"))?;
            Ok(value.map(Value::String).unwrap_or(Value::Null))
        }
        "publishedYear" => {
            let value = conn
                .query_row(
                    "SELECT published_year FROM items WHERE id = ?1",
                    params![item_id],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .optional()
                .map_err(|err| err.to_string())?
                .ok_or_else(|| format!("Book not found: {item_id}"))?;
            Ok(value.map(Value::from).unwrap_or(Value::Null))
        }
        "seriesIndex" => {
            let value = conn
                .query_row(
                    "SELECT series_index FROM items WHERE id = ?1",
                    params![item_id],
                    |row| row.get::<_, Option<f64>>(0),
                )
                .optional()
                .map_err(|err| err.to_string())?
                .ok_or_else(|| format!("Book not found: {item_id}"))?;
            Ok(value.map(Value::from).unwrap_or(Value::Null))
        }
        _ => Err(format!("Unsupported Folio metadata field: {field}")),
    }
}

fn apply_field(
    conn: &Connection,
    item_id: &str,
    field: &str,
    value: &Value,
    source: &str,
    confidence: f64,
    now: i64,
) -> Result<(), String> {
    match field {
        "authors" => {
            conn.execute(
                "DELETE FROM item_authors WHERE item_id = ?1",
                params![item_id],
            )
            .map_err(|err| err.to_string())?;
            let mut seen = std::collections::HashSet::new();
            for (index, author) in value
                .as_array()
                .ok_or_else(|| "Metadata authors must be an array".to_string())?
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|name| seen.insert(normalize_author_name(name)))
                .enumerate()
            {
                let normalized = normalize_author_name(author);
                let author_id = conn
                    .query_row(
                        "SELECT id FROM authors WHERE normalized_name = ?1 LIMIT 1",
                        params![normalized],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|err| err.to_string())?
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                conn.execute(
                    "INSERT OR IGNORE INTO authors (id, name, normalized_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![author_id, author, normalized, now],
                )
                .map_err(|err| err.to_string())?;
                conn.execute(
                    "INSERT OR IGNORE INTO item_authors (item_id, author_id, role, ord) VALUES (?1, ?2, 'author', ?3)",
                    params![item_id, author_id, index as i64],
                )
                .map_err(|err| err.to_string())?;
            }
        }
        "isbn" => {
            let isbn = value.as_str().expect("validated ISBN value").trim();
            conn.execute(
                "DELETE FROM identifiers WHERE item_id = ?1 AND upper(type) IN ('ISBN10', 'ISBN13', 'OTHER')",
                params![item_id],
            )
            .map_err(|err| err.to_string())?;
            let isbn_type = match isbn.len() {
                13 => "ISBN13",
                10 => "ISBN10",
                _ => "OTHER",
            };
            conn.execute(
                "INSERT INTO identifiers (id, item_id, type, value, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![Uuid::new_v4().to_string(), item_id, isbn_type, isbn, source, confidence, now],
            )
            .map_err(|err| err.to_string())?;
        }
        "publishedYear" => update_scalar(
            conn,
            item_id,
            "published_year",
            value.as_i64().expect("validated published year"),
            now,
        )?,
        "seriesIndex" => update_scalar(
            conn,
            item_id,
            "series_index",
            value.as_f64().expect("validated series index"),
            now,
        )?,
        "title" | "language" | "series" | "description" => update_scalar(
            conn,
            item_id,
            scalar_column(field)?,
            value.as_str().expect("validated text value").trim(),
            now,
        )?,
        _ => return Err(format!("Unsupported Folio metadata field: {field}")),
    }

    let provenance_field = match field {
        "publishedYear" => "published_year",
        "seriesIndex" => "series_index",
        value => value,
    };
    conn.execute(
        "INSERT INTO item_field_sources (id, item_id, field, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![Uuid::new_v4().to_string(), item_id, provenance_field, source, confidence, now],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn update_scalar<T: rusqlite::ToSql>(
    conn: &Connection,
    item_id: &str,
    column: &str,
    value: T,
    now: i64,
) -> Result<(), String> {
    conn.execute(
        &format!("UPDATE items SET {column} = ?1, updated_at = ?2 WHERE id = ?3"),
        params![value, now, item_id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn scalar_column(field: &str) -> Result<&'static str, String> {
    match field {
        "title" => Ok("title"),
        "language" => Ok("language"),
        "series" => Ok("series"),
        "description" => Ok("description"),
        _ => Err(format!("Unsupported scalar metadata field: {field}")),
    }
}

fn normalize_author_name(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_lowercase().collect::<String>()
            } else {
                " ".to_string()
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn metadata_values_equal(left: &Value, right: &Value) -> bool {
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => (left - right).abs() < f64::EPSILON,
        _ => left == right,
    }
}

fn has_metadata_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(values) => !values.is_empty(),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_proposal, desktop_representation, CHANGE_TYPE};
    use rusqlite::{params, Connection};
    use serde_json::json;

    #[test]
    fn folio_metadata_proposals_are_presented_as_readable_item_metadata() {
        let proposal = json!({
            "version": 1,
            "itemId": "book-camus",
            "changes": {
                "title": "The Rebel",
                "authors": ["Albert Camus"],
                "publishedYear": 1992
            },
            "expected": {
                "title": "Rebel, The   Albert Camus",
                "authors": [],
                "publishedYear": null
            },
            "source": "applebooks",
            "confidence": 0.48,
            "reason": "Exact catalogue match.",
            "overwrite": true
        });

        let (change_type, changes_json) =
            desktop_representation(CHANGE_TYPE, Some(proposal.to_string()))
                .expect("desktop representation");

        assert_eq!(change_type, "item_metadata");
        let visible: serde_json::Value =
            serde_json::from_str(changes_json.as_deref().expect("visible metadata payload"))
                .expect("valid visible payload");
        assert_eq!(
            visible,
            json!({
                "itemId": "book-camus",
                "metadata": {
                    "title": "The Rebel",
                    "authors": ["Albert Camus"],
                    "publishedYear": 1992
                }
            }),
        );
    }

    #[test]
    fn applying_a_folio_metadata_proposal_updates_metadata_and_provenance() {
        let conn = metadata_fixture();
        let proposal = json!({
            "version": 1,
            "itemId": "book-camus",
            "changes": {
                "title": "The Rebel",
                "authors": ["Albert Camus"],
                "publishedYear": 1992
            },
            "expected": {
                "title": "Rebel, The   Albert Camus",
                "authors": [],
                "publishedYear": null
            },
            "source": "applebooks",
            "confidence": 0.48,
            "reason": "Exact catalogue match.",
            "overwrite": true
        });

        apply_proposal(
            &conn,
            "change-camus",
            "file-camus",
            &proposal.to_string(),
            1_800_000_000_000,
        )
        .expect("proposal applies");

        let item: (String, Option<i64>) = conn
            .query_row(
                "SELECT title, published_year FROM items WHERE id = 'book-camus'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("updated item");
        assert_eq!(item, ("The Rebel".to_string(), Some(1992)));
        let authors: Vec<String> = conn
            .prepare(
                "SELECT authors.name FROM item_authors JOIN authors ON authors.id = item_authors.author_id WHERE item_authors.item_id = 'book-camus' ORDER BY item_authors.ord",
            )
            .expect("author query")
            .query_map([], |row| row.get(0))
            .expect("author rows")
            .map(Result::unwrap)
            .collect();
        assert_eq!(authors, vec!["Albert Camus"]);
        let provenance: Vec<(String, String, f64)> = conn
            .prepare(
                "SELECT field, source, confidence FROM item_field_sources WHERE item_id = 'book-camus' ORDER BY field",
            )
            .expect("provenance query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("provenance rows")
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            provenance,
            vec![
                ("authors".to_string(), "applebooks".to_string(), 0.48),
                ("published_year".to_string(), "applebooks".to_string(), 0.48),
                ("title".to_string(), "applebooks".to_string(), 0.48),
            ],
        );
        let status: (String, Option<i64>) = conn
            .query_row(
                "SELECT status, applied_at FROM pending_changes WHERE id = 'change-camus'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("applied proposal status");
        assert_eq!(status, ("applied".to_string(), Some(1_800_000_000_000)));
    }

    #[test]
    fn applying_a_stale_folio_metadata_proposal_preserves_newer_metadata() {
        let conn = metadata_fixture();
        conn.execute(
            "UPDATE items SET title = 'Manually reviewed title' WHERE id = 'book-camus'",
            [],
        )
        .expect("newer metadata");
        let proposal = json!({
            "version": 1,
            "itemId": "book-camus",
            "changes": { "title": "The Rebel" },
            "expected": { "title": "Rebel, The   Albert Camus" },
            "source": "applebooks",
            "confidence": 0.48,
            "reason": "Exact catalogue match.",
            "overwrite": true
        });

        let error = apply_proposal(
            &conn,
            "change-camus",
            "file-camus",
            &proposal.to_string(),
            1_800_000_000_000,
        )
        .expect_err("stale proposal must be rejected");

        assert!(error.contains("Metadata changed since this proposal was created: title"));
        let title: String = conn
            .query_row(
                "SELECT title FROM items WHERE id = 'book-camus'",
                [],
                |row| row.get(0),
            )
            .expect("preserved title");
        assert_eq!(title, "Manually reviewed title");
        let provenance_count: i64 = conn
            .query_row("SELECT count(*) FROM item_field_sources", [], |row| {
                row.get(0)
            })
            .expect("provenance count");
        assert_eq!(provenance_count, 0);
        let status: String = conn
            .query_row(
                "SELECT status FROM pending_changes WHERE id = 'change-camus'",
                [],
                |row| row.get(0),
            )
            .expect("pending status");
        assert_eq!(status, "pending");
    }

    fn metadata_fixture() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE items (
               id TEXT PRIMARY KEY,
               title TEXT,
               language TEXT,
               published_year INTEGER,
               series TEXT,
               series_index REAL,
               description TEXT,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE files (
               id TEXT PRIMARY KEY,
               item_id TEXT NOT NULL REFERENCES items(id),
               status TEXT NOT NULL
             );
             CREATE TABLE authors (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               normalized_name TEXT,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE item_authors (
               item_id TEXT NOT NULL REFERENCES items(id),
               author_id TEXT NOT NULL REFERENCES authors(id),
               role TEXT,
               ord INTEGER,
               PRIMARY KEY (item_id, author_id, role)
             );
             CREATE TABLE identifiers (
               id TEXT PRIMARY KEY,
               item_id TEXT NOT NULL REFERENCES items(id),
               type TEXT NOT NULL,
               value TEXT NOT NULL,
               source TEXT,
               confidence REAL,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE item_field_sources (
               id TEXT PRIMARY KEY,
               item_id TEXT NOT NULL REFERENCES items(id),
               field TEXT NOT NULL,
               source TEXT NOT NULL,
               confidence REAL,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE pending_changes (
               id TEXT PRIMARY KEY,
               status TEXT NOT NULL,
               applied_at INTEGER,
               error TEXT
             );",
        )
        .expect("metadata schema");
        conn.execute(
            "INSERT INTO items (id, title, updated_at) VALUES (?1, ?2, 1)",
            params!["book-camus", "Rebel, The   Albert Camus"],
        )
        .expect("item");
        conn.execute(
            "INSERT INTO files (id, item_id, status) VALUES ('file-camus', 'book-camus', 'active')",
            [],
        )
        .expect("file");
        conn.execute(
            "INSERT INTO pending_changes (id, status) VALUES ('change-camus', 'pending')",
            [],
        )
        .expect("pending proposal");
        conn
    }
}
