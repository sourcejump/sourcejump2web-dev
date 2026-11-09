//! Map tiers: a difficulty per map and track, out of the tier count in the `tiers` policy.
//!
//! Both the count and each map's tier are community decisions that staff record, so the API serves a tier
//! only once staff have published a count (the `tiers` policy, `policies.rs`).

/// The tier count in force, or `None` while the community hasn't decided one.
pub async fn tier_count(db: impl sqlx::PgExecutor<'_>) -> Result<Option<i16>, sqlx::Error> {
    let count = sqlx::query_scalar!(
        r#"SELECT (value->>'count')::smallint AS count FROM policies WHERE name = 'tiers' ORDER BY version DESC LIMIT 1"#
    )
    .fetch_optional(db)
    .await?;
    Ok(count.flatten())
}

/// How many maps on the map list (maps with a run) have each main-track tier, `None` for those without one.
pub async fn listed_maps_per_tier(
    db: impl sqlx::PgExecutor<'_>,
) -> Result<Vec<(Option<i16>, i64)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT tier.tier AS "tier?", count(*) AS "maps!" FROM maps m
           LEFT JOIN current_map_tiers tier ON tier.map_id = m.id AND tier.track = 0
           WHERE m.last_run_at IS NOT NULL
           GROUP BY tier.tier"#
    )
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|row| (row.tier, row.maps)).collect())
}

/// Counts per tier laid out tier 1 first, one slot per tier in the count. Empty while no count is published;
/// untiered counts and any tier past the count are left out.
pub fn by_tier(counts: &[(Option<i16>, i64)], tier_count: Option<i16>) -> Vec<i64> {
    let mut slots = vec![0; usize::try_from(tier_count.unwrap_or(0)).unwrap_or(0)];
    for &(tier, count) in counts {
        let slot = tier
            .and_then(|tier| usize::try_from(tier - 1).ok())
            .and_then(|index| slots.get_mut(index));
        if let Some(slot) = slot {
            *slot += count;
        }
    }
    slots
}
