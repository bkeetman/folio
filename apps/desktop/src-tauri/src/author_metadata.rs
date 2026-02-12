use reqwest::blocking::Client;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

const HTTP_TIMEOUT_SECS: u64 = 6;
const HTTP_MAX_RETRIES: u64 = 1;
const HTTP_USER_AGENT: &str = "Folio/0.1 (+https://github.com/bkeetman/folio)";
static AUTHOR_METADATA_DEBUG_ENABLED: OnceLock<bool> = OnceLock::new();

#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthorSourceSelection {
    pub(crate) open_library: bool,
    pub(crate) wikidata: bool,
    pub(crate) wikipedia: bool,
}

impl AuthorSourceSelection {
    pub(crate) fn with_fallback(mut self) -> Self {
        if !self.open_library && !self.wikidata && !self.wikipedia {
            self.open_library = true;
        }
        self
    }
}

#[derive(Debug, Clone)]
struct AuthorMetadataCandidate {
    source: &'static str,
    source_id: Option<String>,
    bio: Option<String>,
    photo_url: Option<String>,
    confidence: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct MergedAuthorMetadata {
    pub(crate) metadata_source: String,
    pub(crate) metadata_source_id: Option<String>,
    pub(crate) bio: Option<String>,
    pub(crate) photo_url: Option<String>,
}

pub(crate) fn fetch_merged_author_metadata(
    author_name: &str,
    sources: AuthorSourceSelection,
) -> Option<MergedAuthorMetadata> {
    let selection = sources.with_fallback();
    let mut candidates: Vec<AuthorMetadataCandidate> = vec![];
    let debug_enabled = author_metadata_debug_enabled();

    if debug_enabled {
        log::info!(
            "[metadata-debug] author enrich start name=\"{}\" sources=open_library:{} wikidata:{} wikipedia:{}",
            author_name,
            selection.open_library,
            selection.wikidata,
            selection.wikipedia
        );
    }

    if selection.open_library {
        if let Some(candidate) = fetch_openlibrary_author_metadata(author_name) {
            if debug_enabled {
                log::info!(
                    "[metadata-debug] author source hit source=openlibrary {}",
                    summarize_candidate(&candidate)
                );
            }
            candidates.push(candidate);
        } else if debug_enabled {
            log::info!("[metadata-debug] author source miss source=openlibrary");
        }
    }
    if selection.wikidata {
        if let Some(candidate) = fetch_wikidata_author_metadata(author_name) {
            if debug_enabled {
                log::info!(
                    "[metadata-debug] author source hit source=wikidata {}",
                    summarize_candidate(&candidate)
                );
            }
            candidates.push(candidate);
        } else if debug_enabled {
            log::info!("[metadata-debug] author source miss source=wikidata");
        }
    }
    if selection.wikipedia {
        if let Some(candidate) = fetch_wikipedia_author_metadata(author_name) {
            if debug_enabled {
                log::info!(
                    "[metadata-debug] author source hit source=wikipedia {}",
                    summarize_candidate(&candidate)
                );
            }
            candidates.push(candidate);
        } else if debug_enabled {
            log::info!("[metadata-debug] author source miss source=wikipedia");
        }
    }

    let merged = merge_author_metadata(candidates);
    if debug_enabled {
        match merged.as_ref() {
            Some(value) => {
                log::info!(
                    "[metadata-debug] author enrich merged source={} source_id={} bio={} photo={}",
                    value.metadata_source,
                    value.metadata_source_id.as_deref().unwrap_or("-"),
                    value.bio.as_ref().map(|bio| bio.len()).unwrap_or(0),
                    value.photo_url.is_some()
                );
            }
            None => {
                log::info!("[metadata-debug] author enrich merged=none");
            }
        }
    }
    merged
}

fn merge_author_metadata(candidates: Vec<AuthorMetadataCandidate>) -> Option<MergedAuthorMetadata> {
    if candidates.is_empty() {
        return None;
    }

    let mut scored = candidates
        .into_iter()
        .filter(|candidate| candidate.confidence >= 0.45)
        .collect::<Vec<_>>();
    if scored.is_empty() {
        return None;
    }

    scored.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    let primary = scored.first()?;

    let bio = scored
        .iter()
        .filter_map(|candidate| {
            candidate.bio.as_ref().map(|bio| {
                let len_bonus = (bio.chars().count() as f64 / 1500.0).min(0.12);
                (bio.clone(), candidate.confidence + len_bonus)
            })
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(bio, _)| bio);

    let photo_url = scored
        .iter()
        .filter_map(|candidate| {
            candidate.photo_url.as_ref().map(|url| {
                let quality_bonus = estimate_photo_quality_bonus(url);
                (url.clone(), candidate.confidence + quality_bonus)
            })
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(url, _)| url);

    if bio.is_none() && photo_url.is_none() {
        return None;
    }

    let metadata_source_id = scored
        .iter()
        .find_map(|candidate| {
            if candidate.source == "wikidata" {
                candidate.source_id.clone()
            } else {
                None
            }
        })
        .or_else(|| {
            scored
                .iter()
                .find_map(|candidate| candidate.source_id.clone())
        });

    let unique_sources = dedupe_sources(
        scored
            .iter()
            .filter(|candidate| candidate.bio.is_some() || candidate.photo_url.is_some())
            .map(|candidate| candidate.source)
            .collect(),
    );

    let metadata_source = if unique_sources.len() > 1 {
        "merged".to_string()
    } else {
        primary.source.to_string()
    };

    Some(MergedAuthorMetadata {
        metadata_source,
        metadata_source_id,
        bio,
        photo_url,
    })
}

fn fetch_openlibrary_author_metadata(author_name: &str) -> Option<AuthorMetadataCandidate> {
    let cleaned = normalize_ws(author_name);
    if cleaned.is_empty() {
        return None;
    }

    let search_url = format!(
        "https://openlibrary.org/search/authors.json?q={}&limit=6",
        urlencoding::encode(&cleaned)
    );
    let search_data = fetch_json_with_retry(&search_url)?;
    let docs = search_data
        .get("docs")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let target_key = normalize_author_key(&cleaned);
    let mut best_doc: Option<&Value> = None;
    let mut best_score = 0.0f64;

    for doc in &docs {
        let key = doc
            .get("key")
            .and_then(|value| value.as_str())
            .map(|value| value.trim())
            .unwrap_or("");
        if key.is_empty() {
            continue;
        }
        let doc_name = doc
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim())
            .unwrap_or("");
        let score = author_name_match_score(&target_key, doc_name);
        if score > best_score {
            best_score = score;
            best_doc = Some(doc);
        }
    }

    if best_score < 0.52 {
        return None;
    }

    let best_doc = best_doc?;
    let source_id = best_doc
        .get("key")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())?;

    let details_path = if source_id.starts_with("http://") || source_id.starts_with("https://") {
        source_id.clone()
    } else if source_id.starts_with("/authors/") {
        if source_id.ends_with(".json") {
            source_id.clone()
        } else {
            format!("{}.json", source_id)
        }
    } else if source_id.starts_with("OL") && source_id.ends_with('A') {
        format!("/authors/{}.json", source_id)
    } else {
        format!("/{}.json", source_id.trim_start_matches('/'))
    };

    let details_url = if details_path.starts_with("http://") || details_path.starts_with("https://")
    {
        details_path
    } else {
        format!("https://openlibrary.org{}", details_path)
    };

    let details = fetch_json_with_retry(&details_url)?;

    let bio = extract_openlibrary_author_bio(&details)
        .or_else(|| extract_openlibrary_author_bio(best_doc))
        .and_then(non_empty);

    let photo_url = details
        .get("photos")
        .and_then(|value| value.as_array())
        .and_then(|values| values.first())
        .and_then(|entry| {
            if let Some(id) = entry.as_i64() {
                Some(format!("https://covers.openlibrary.org/a/id/{}-L.jpg", id))
            } else {
                entry
                    .as_str()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .map(|value| format!("https://covers.openlibrary.org/a/id/{}-L.jpg", value))
            }
        });

    let completeness = if bio.is_some() || photo_url.is_some() {
        0.08
    } else {
        0.0
    };

    Some(AuthorMetadataCandidate {
        source: "openlibrary",
        source_id: Some(source_id),
        bio,
        photo_url,
        confidence: clamp(0.55 + best_score * 0.35 + completeness, 0.45, 0.98),
    })
}

fn fetch_wikidata_author_metadata(author_name: &str) -> Option<AuthorMetadataCandidate> {
    let cleaned = normalize_ws(author_name);
    if cleaned.is_empty() {
        return None;
    }

    let search_url = format!(
        "https://www.wikidata.org/w/api.php?action=wbsearchentities&search={}&language=en&type=item&limit=6&format=json",
        urlencoding::encode(&cleaned)
    );
    let search_data = fetch_json_with_retry(&search_url)?;
    let entries = search_data
        .get("search")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let target_key = normalize_author_key(&cleaned);
    let mut best: Option<(&Value, f64)> = None;

    for entry in &entries {
        let id = entry
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let label = entry
            .get("label")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let description = entry
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        let mut score = author_name_match_score(&target_key, label);
        if looks_like_author_description(description) {
            score += 0.15;
        } else {
            score -= 0.1;
        }
        if looks_like_non_person_description(description) {
            score -= 0.35;
        }
        if !has_required_name_token_match(author_name, &[label]) {
            score -= 0.45;
        }
        score = clamp(score, 0.0, 1.0);

        if best.map(|(_, current)| score > current).unwrap_or(true) {
            best = Some((entry, score));
        }
    }

    let (best_entry, best_score) = best?;
    if best_score < 0.52 {
        return None;
    }

    let source_id = best_entry
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())?;

    let entity_url = format!(
        "https://www.wikidata.org/wiki/Special:EntityData/{}.json",
        urlencoding::encode(&source_id)
    );
    let entity_data = fetch_json_with_retry(&entity_url)?;
    let entity = entity_data
        .get("entities")
        .and_then(|value| value.get(&source_id))?;

    let bio = extract_wikidata_description(entity);
    let photo_url = extract_wikidata_image_url(entity);

    Some(AuthorMetadataCandidate {
        source: "wikidata",
        source_id: Some(source_id),
        bio,
        photo_url,
        confidence: clamp(0.52 + best_score * 0.36, 0.45, 0.97),
    })
}

fn fetch_wikipedia_author_metadata(author_name: &str) -> Option<AuthorMetadataCandidate> {
    let cleaned = normalize_ws(author_name);
    if cleaned.is_empty() {
        return None;
    }

    let search_url = format!(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={}&srlimit=6&format=json",
        urlencoding::encode(&cleaned)
    );
    let search_data = fetch_json_with_retry(&search_url)?;
    let entries = search_data
        .get("query")
        .and_then(|value| value.get("search"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let target_key = normalize_author_key(&cleaned);
    let mut best: Option<(&Value, f64)> = None;

    for entry in &entries {
        let title = entry
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if title.is_empty() {
            continue;
        }
        let score = author_name_match_score(&target_key, title);
        if best.map(|(_, current)| score > current).unwrap_or(true) {
            best = Some((entry, score));
        }
    }

    let (best_entry, best_score) = best?;
    if best_score < 0.5 {
        return None;
    }

    let page_title = best_entry
        .get("title")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())?;

    if !has_required_name_token_match(author_name, &[page_title]) {
        return None;
    }

    let summary_url = format!(
        "https://en.wikipedia.org/api/rest_v1/page/summary/{}",
        urlencoding::encode(page_title)
    );
    let summary = fetch_json_with_retry(&summary_url)?;

    if summary
        .get("type")
        .and_then(|value| value.as_str())
        .map(|value| value.eq_ignore_ascii_case("disambiguation"))
        .unwrap_or(false)
    {
        return None;
    }

    let description = summary
        .get("description")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if looks_like_non_person_description(&description)
        || looks_like_name_page_description(&description)
    {
        return None;
    }

    let bio = summary
        .get("extract")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .and_then(non_empty);

    let bio_text = bio.clone().unwrap_or_default();
    if !has_required_name_token_match(author_name, &[page_title, &description, &bio_text]) {
        return None;
    }
    let context = format!("{} {}", description, bio_text);
    if !looks_like_author_description(&context) && !looks_like_person_context(&context) {
        return None;
    }

    let photo_url = summary
        .get("originalimage")
        .and_then(|value| value.get("source"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| {
            summary
                .get("thumbnail")
                .and_then(|value| value.get("source"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        });

    let source_id = summary
        .get("wikibase_item")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| {
            summary
                .get("pageid")
                .and_then(|value| value.as_i64())
                .map(|value| value.to_string())
        })
        .or_else(|| Some(page_title.to_string()));

    Some(AuthorMetadataCandidate {
        source: "wikipedia",
        source_id,
        bio,
        photo_url,
        confidence: clamp(0.5 + best_score * 0.34, 0.45, 0.95),
    })
}

fn fetch_json_with_retry(url: &str) -> Option<Value> {
    let debug_enabled = author_metadata_debug_enabled();
    let client = Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .ok()?;

    if debug_enabled {
        log::info!("[metadata-debug] author http start url={}", url);
    }

    for attempt in 0..=HTTP_MAX_RETRIES {
        let response = client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::USER_AGENT, HTTP_USER_AGENT)
            .send();

        let response = match response {
            Ok(value) => value,
            Err(_) => {
                if debug_enabled {
                    log::warn!(
                        "[metadata-debug] author http transport_error url={} attempt={}",
                        url,
                        attempt + 1
                    );
                }
                if attempt < HTTP_MAX_RETRIES {
                    std::thread::sleep(Duration::from_millis(350 * (attempt + 1)));
                    continue;
                }
                return None;
            }
        };

        let status = response.status();
        if status.is_success() {
            if debug_enabled {
                log::info!(
                    "[metadata-debug] author http success url={} status={}",
                    url,
                    status
                );
            }
            return response.json::<Value>().ok();
        }

        if debug_enabled {
            log::warn!(
                "[metadata-debug] author http status url={} status={} attempt={}",
                url,
                status,
                attempt + 1
            );
        }

        if (status.as_u16() == 429 || status.is_server_error()) && attempt < HTTP_MAX_RETRIES {
            let retry_after_ms = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|value| value * 1000)
                .unwrap_or(350 * (attempt + 1));
            std::thread::sleep(Duration::from_millis(retry_after_ms.min(4_000)));
            continue;
        }

        return None;
    }

    None
}

fn author_metadata_debug_enabled() -> bool {
    *AUTHOR_METADATA_DEBUG_ENABLED.get_or_init(|| {
        std::env::var("FOLIO_AUTHOR_METADATA_DEBUG")
            .or_else(|_| std::env::var("FOLIO_METADATA_DEBUG"))
            .map(|value| {
                let lowered = value.trim().to_ascii_lowercase();
                lowered == "1" || lowered == "true" || lowered == "yes" || lowered == "on"
            })
            .unwrap_or(false)
    })
}

fn summarize_candidate(candidate: &AuthorMetadataCandidate) -> String {
    format!(
        "confidence={:.2} source_id={} bio={} photo={}",
        candidate.confidence,
        candidate.source_id.as_deref().unwrap_or("-"),
        candidate.bio.as_ref().map(|bio| bio.len()).unwrap_or(0),
        candidate.photo_url.is_some()
    )
}

fn extract_openlibrary_author_bio(value: &Value) -> Option<String> {
    let bio = value.get("bio")?;
    match bio {
        Value::String(text) => non_empty(text.to_string()),
        Value::Object(map) => map
            .get("value")
            .and_then(|entry| entry.as_str())
            .map(|text| text.to_string())
            .and_then(non_empty),
        _ => None,
    }
}

fn extract_wikidata_description(entity: &Value) -> Option<String> {
    entity
        .get("descriptions")
        .and_then(|value| value.as_object())
        .and_then(|entries| {
            entries
                .get("en")
                .or_else(|| entries.get("nl"))
                .or_else(|| entries.values().next())
        })
        .and_then(|value| value.get("value"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .and_then(non_empty)
}

fn extract_wikidata_image_url(entity: &Value) -> Option<String> {
    let image_name = entity
        .get("claims")
        .and_then(|value| value.get("P18"))
        .and_then(|value| value.as_array())
        .and_then(|claims| claims.first())
        .and_then(|claim| claim.get("mainsnak"))
        .and_then(|value| value.get("datavalue"))
        .and_then(|value| value.get("value"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())?;

    Some(format!(
        "https://commons.wikimedia.org/wiki/Special:FilePath/{}",
        urlencoding::encode(image_name)
    ))
}

fn looks_like_author_description(value: &str) -> bool {
    let lowered = value.to_lowercase();
    [
        "author",
        "writer",
        "novelist",
        "poet",
        "playwright",
        "essayist",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn looks_like_non_person_description(value: &str) -> bool {
    let lowered = value.to_lowercase();
    [
        "painting",
        "film",
        "album",
        "song",
        "tv",
        "television",
        "episode",
        "character",
        "novel by",
        "book by",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn looks_like_name_page_description(value: &str) -> bool {
    let lowered = value.to_lowercase();
    [
        "given name",
        "first name",
        "family name",
        "surname",
        "disambiguation",
        "name of",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn looks_like_person_context(value: &str) -> bool {
    let lowered = value.to_lowercase();
    [
        "born",
        "is a ",
        "person",
        "people",
        "biography",
        "he is",
        "she is",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn has_required_name_token_match(expected_name: &str, candidates: &[&str]) -> bool {
    let required = required_name_tokens(expected_name);
    if required.is_empty() {
        return true;
    }

    let mut candidate_tokens: std::collections::HashSet<String> = std::collections::HashSet::new();
    for candidate in candidates {
        let key = normalize_author_key(candidate);
        if key.is_empty() {
            continue;
        }
        candidate_tokens.extend(tokenize(&key));
    }

    required.iter().all(|token| candidate_tokens.contains(token))
}

fn required_name_tokens(name: &str) -> Vec<String> {
    let key = normalize_author_key(name);
    let tokens = key
        .split_whitespace()
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<String>>();
    if tokens.len() < 2 {
        return vec![];
    }

    let particles = [
        "de", "den", "der", "van", "von", "da", "di", "la", "le", "du", "del", "della",
        "ten", "ter", "op",
    ];

    tokens
        .into_iter()
        .filter(|token| token.len() >= 3 && !particles.contains(&token.as_str()))
        .skip(1)
        .collect::<Vec<String>>()
}

fn dedupe_sources(values: Vec<&'static str>) -> Vec<&'static str> {
    let mut result = vec![];
    for value in values {
        if !result.contains(&value) {
            result.push(value);
        }
    }
    result
}

fn estimate_photo_quality_bonus(url: &str) -> f64 {
    let lowered = url.to_lowercase();
    if lowered.contains("1200x1200") || lowered.contains("-l.jpg") {
        return 0.12;
    }
    if let Some(width) = parse_wikipedia_thumbnail_width(&lowered) {
        return (width as f64 / 2000.0).min(0.1);
    }
    if lowered.contains("original") || lowered.contains("filepath") {
        return 0.09;
    }
    0.03
}

fn parse_wikipedia_thumbnail_width(url: &str) -> Option<u32> {
    let marker = "px-";
    let index = url.find(marker)?;
    let prefix = &url[..index];
    let start = prefix.rfind('/')? + 1;
    prefix.get(start..)?.parse::<u32>().ok()
}

fn author_name_match_score(expected_key: &str, candidate_name: &str) -> f64 {
    let candidate_key = normalize_author_key(candidate_name);
    if expected_key.is_empty() || candidate_key.is_empty() {
        return 0.0;
    }
    if expected_key == candidate_key {
        return 1.0;
    }
    if candidate_key.starts_with(&(expected_key.to_string() + " ")) {
        return 0.88;
    }
    if expected_key.starts_with(&(candidate_key.to_string() + " ")) {
        let candidate_token_count = tokenize(&candidate_key).len();
        if candidate_token_count >= 2 {
            return 0.55;
        }
        return 0.25;
    }

    let token_score = similarity(expected_key, &candidate_key);
    let contains_bonus =
        if candidate_key.contains(expected_key) || expected_key.contains(&candidate_key) {
            0.1
        } else {
            0.0
        };

    clamp(token_score + contains_bonus, 0.0, 0.95)
}

fn similarity(a: &str, b: &str) -> f64 {
    let a_tokens = tokenize(a);
    let b_tokens = tokenize(b);
    if a_tokens.is_empty() || b_tokens.is_empty() {
        return 0.0;
    }
    let intersection = a_tokens
        .iter()
        .filter(|token| b_tokens.contains(*token))
        .count() as f64;
    let union = a_tokens.union(&b_tokens).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn tokenize(value: &str) -> std::collections::HashSet<String> {
    value
        .to_lowercase()
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(|token| token.to_string())
        .collect()
}

fn normalize_ws(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn normalize_author_key(value: &str) -> String {
    let collapsed = normalize_ws(value);
    let mut lowered = String::new();
    for ch in collapsed.chars() {
        if ch.is_alphanumeric() {
            lowered.extend(ch.to_lowercase());
        } else {
            lowered.push(' ');
        }
    }
    normalize_ws(&lowered)
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

#[cfg(test)]
mod tests {
    use super::{
        fetch_openlibrary_author_metadata, fetch_wikidata_author_metadata,
        fetch_wikipedia_author_metadata, merge_author_metadata, AuthorMetadataCandidate,
        AuthorSourceSelection,
    };

    #[test]
    fn keeps_best_source_but_falls_back_missing_bio() {
        let merged = merge_author_metadata(vec![
            AuthorMetadataCandidate {
                source: "openlibrary",
                source_id: Some("/authors/OL1A".to_string()),
                bio: None,
                photo_url: Some("https://covers.openlibrary.org/a/id/1-L.jpg".to_string()),
                confidence: 0.9,
            },
            AuthorMetadataCandidate {
                source: "wikipedia",
                source_id: Some("Douglas_Adams".to_string()),
                bio: Some("Douglas Adams was an English author and humorist.".to_string()),
                photo_url: None,
                confidence: 0.78,
            },
        ])
        .expect("expected merged metadata");

        assert_eq!(merged.metadata_source, "merged");
        assert!(merged.bio.unwrap_or_default().contains("Douglas Adams"));
        assert!(merged
            .photo_url
            .unwrap_or_default()
            .contains("openlibrary.org"));
    }

    #[test]
    fn prefers_wikidata_id_when_available() {
        let merged = merge_author_metadata(vec![
            AuthorMetadataCandidate {
                source: "wikipedia",
                source_id: Some("Q42".to_string()),
                bio: Some("English author".to_string()),
                photo_url: None,
                confidence: 0.7,
            },
            AuthorMetadataCandidate {
                source: "wikidata",
                source_id: Some("Q42".to_string()),
                bio: Some("English writer and humorist".to_string()),
                photo_url: Some(
                    "https://commons.wikimedia.org/wiki/Special:FilePath/Douglas_adams_portrait.jpg"
                        .to_string(),
                ),
                confidence: 0.82,
            },
        ])
        .expect("expected merged metadata");

        assert_eq!(merged.metadata_source_id.as_deref(), Some("Q42"));
    }

    #[test]
    fn filters_out_candidates_without_any_usable_fields() {
        let merged = merge_author_metadata(vec![AuthorMetadataCandidate {
            source: "wikidata",
            source_id: Some("Q1".to_string()),
            bio: None,
            photo_url: None,
            confidence: 0.92,
        }]);

        assert!(merged.is_none());
    }

    #[test]
    fn source_selection_falls_back_to_openlibrary_when_all_disabled() {
        let selection = AuthorSourceSelection {
            open_library: false,
            wikidata: false,
            wikipedia: false,
        }
        .with_fallback();

        assert!(selection.open_library);
    }

    #[test]
    #[ignore = "network probe for manual debugging"]
    fn live_source_probe() {
        let env_names = std::env::var("FOLIO_AUTHOR_PROBE_NAMES")
            .ok()
            .map(|raw| {
                raw.split('|')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| value.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let names = if env_names.is_empty() {
            vec![
                "A. van Aardenburg".to_string(),
                "J.K. Rowling".to_string(),
                "Haruki Murakami".to_string(),
            ]
        } else {
            env_names
        };
        for name in &names {
            let open_library = fetch_openlibrary_author_metadata(name);
            let wikidata = fetch_wikidata_author_metadata(name);
            let wikipedia = fetch_wikipedia_author_metadata(name);
            println!(
                "probe name=\"{}\" openlibrary={} wikidata={} wikipedia={}",
                name,
                open_library
                    .as_ref()
                    .map(super::summarize_candidate)
                    .unwrap_or_else(|| "none".to_string()),
                wikidata
                    .as_ref()
                    .map(super::summarize_candidate)
                    .unwrap_or_else(|| "none".to_string()),
                wikipedia
                    .as_ref()
                    .map(super::summarize_candidate)
                    .unwrap_or_else(|| "none".to_string())
            );
        }
    }
}
