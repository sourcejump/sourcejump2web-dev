//! Searching by name, shared by the map and player lists: what counts as a match, and how close a near miss
//! must be.
//!
//! A name matches when it contains the search, or when it nearly does: `pg_trgm`'s word similarity, which
//! forgives a missing, extra or wrong letter (`monstr_jam`, "strafecat"). It doesn't forgive swapped letters
//! in a short word ("cnady"); trigrams can't see those. Lists rank near misses after real matches.

use sqlx::{PgPool, Postgres, Transaction};

/// How similar a near miss must be, 0 to 1. Lower lets in more unrelated names; 0.5 found the intended
/// map or player for common typos in the legacy data without a long tail of noise (2026-10-27).
const NEAR_MISS_THRESHOLD: f64 = 0.5;

/// Searches shorter than this have too few trigrams for a near miss to mean anything.
const NEAR_MISS_MIN_CHARS: usize = 3;

/// A transaction whose queries use the near-miss threshold. The `<%` operator, which the trigram indexes
/// serve, reads its threshold from a setting rather than taking it as an argument.
pub async fn begin(db: &PgPool) -> Result<Transaction<'static, Postgres>, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT set_config('pg_trgm.word_similarity_threshold', $1, true)")
        .bind(NEAR_MISS_THRESHOLD.to_string())
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}

/// An `ILIKE` pattern for names containing the search, matched literally: `%` and `_` in it are just
/// characters.
pub fn contains_pattern(search: &str) -> String {
    let escaped = search
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// A search as map names are written: lower case, with underscores for spaces, since no map name has a space
/// and players often type one ("candy saarc"). None for an empty search.
pub fn as_map_name(q: &str) -> Option<String> {
    let words: Vec<&str> = q.split_whitespace().collect();
    (!words.is_empty()).then(|| words.join("_").to_lowercase())
}

/// The part of a search to compare near misses against, or None when it's too short to compare.
pub fn near_miss_term(search: &str) -> Option<&str> {
    (search.chars().count() >= NEAR_MISS_MIN_CHARS).then_some(search)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns_match_wildcards_literally() {
        assert_eq!(contains_pattern("50%_off"), "%50\\%\\_off%");
    }

    #[test]
    fn short_searches_have_no_near_misses() {
        assert_eq!(near_miss_term("ab"), None);
        assert_eq!(near_miss_term("abc"), Some("abc"));
    }
}
