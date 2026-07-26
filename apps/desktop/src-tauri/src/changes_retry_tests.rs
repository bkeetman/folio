use super::{reset_failed_pending_changes, reset_failed_sync_changes};
use rusqlite::{params, Connection};

#[test]
fn retrying_file_changes_only_resets_requested_errors() {
    let conn = Connection::open_in_memory().expect("in-memory database");
    conn.execute_batch(
        "CREATE TABLE pending_changes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT
        );",
    )
    .expect("pending changes schema");
    for (id, status, error) in [
        ("failed-one", "error", Some("disk full")),
        ("failed-two", "error", Some("permission denied")),
        ("waiting", "pending", None),
    ] {
        conn.execute(
            "INSERT INTO pending_changes (id, type, status, error) VALUES (?1, 'rename', ?2, ?3)",
            params![id, status, error],
        )
        .expect("pending change");
    }

    assert_eq!(
        reset_failed_pending_changes(&conn, &["failed-one".to_string()]).unwrap(),
        vec!["failed-one".to_string()]
    );
    let first: (String, Option<String>) = conn
        .query_row(
            "SELECT status, error FROM pending_changes WHERE id = 'failed-one'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let second: String = conn
        .query_row(
            "SELECT status FROM pending_changes WHERE id = 'failed-two'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(first, ("pending".to_string(), None));
    assert_eq!(second, "error");
    assert_eq!(
        reset_failed_pending_changes(&conn, &["waiting".to_string()]).unwrap(),
        vec!["waiting".to_string()]
    );
}

#[test]
fn retrying_sync_changes_only_resets_requested_errors() {
    let conn = Connection::open_in_memory().expect("in-memory database");
    conn.execute_batch(
        "CREATE TABLE ereader_sync_queue (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL
        );
        INSERT INTO ereader_sync_queue (id, status) VALUES
            ('failed-one', 'error'),
            ('failed-two', 'error'),
            ('waiting', 'pending');",
    )
    .expect("sync queue schema");

    assert_eq!(
        reset_failed_sync_changes(&conn, &["failed-two".to_string()]).unwrap(),
        vec!["failed-two".to_string()]
    );
    let statuses: Vec<(String, String)> = conn
        .prepare("SELECT id, status FROM ereader_sync_queue ORDER BY id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();

    assert_eq!(
        statuses,
        vec![
            ("failed-one".to_string(), "error".to_string()),
            ("failed-two".to_string(), "pending".to_string()),
            ("waiting".to_string(), "pending".to_string()),
        ]
    );
    assert_eq!(
        reset_failed_sync_changes(&conn, &["waiting".to_string()]).unwrap(),
        vec!["waiting".to_string()]
    );
}
