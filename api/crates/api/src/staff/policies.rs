//! Publishing policy versions from the command line (`tiers count`), logged like every staff change. Policies
//! aren't edited on the site: the lead decided rules and policies change in code (2026-10-21), and the tier
//! count waits on the community.

use serde_json::json;
use sqlx::PgPool;

use super::{
    ChangeError,
    log::{self, StaffAction},
};
use crate::{
    players::SteamId64,
    policies::{self, Policy},
};

/// Publishes `policy` as the version after `based_on` (None: its first version) and logs it.
pub async fn publish_policy(
    db: &PgPool,
    actor: Option<SteamId64>,
    based_on: Option<i32>,
    policy: &Policy,
    note: Option<&str>,
) -> Result<i32, ChangeError> {
    policy.check().map_err(ChangeError::Invalid)?;
    let mut tx = db.begin().await?;
    if policies::current_version(&mut tx, policy.name()).await? != based_on {
        return Err(ChangeError::Stale);
    }
    if let Some(version) = based_on {
        let current = sqlx::query_scalar!(
            "SELECT value FROM policies WHERE name = $1 AND version = $2",
            policy.name(),
            version
        )
        .fetch_one(&mut *tx)
        .await?;
        if Policy::from_row(policy.name(), &current).as_ref() == Some(policy) {
            return Err(ChangeError::Unchanged);
        }
    }
    if let Policy::Tiers(tiers) = policy {
        // A smaller count would leave maps rated above it; staff move those first.
        let highest = sqlx::query_scalar!(
            r#"
            SELECT max(tier) FROM current_map_tiers
            "#
        )
        .fetch_one(&mut *tx)
        .await?;
        if let Some(highest) = highest.filter(|&highest| highest > tiers.count) {
            return Err(ChangeError::Invalid(format!(
                "a map is rated tier {highest}; give it a lower tier before lowering the count"
            )));
        }
    }
    let version = policies::publish(&mut tx, policy).await?;
    // Points depend on both: the formula, and whether tiers are in force.
    if matches!(policy, Policy::Tiers(_) | Policy::Points(_)) {
        crate::leaderboards::standings::refresh_all(&mut tx).await?;
    }
    let entry = log::Entry {
        actor,
        action: StaffAction::PublishPolicy,
        target: policy.name(),
        reason: note,
        detail: json!({ "version": version, "value": policy }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::*;

    #[sqlx::test]
    async fn the_tier_count_cant_drop_below_a_rated_map(db: PgPool) {
        let mut conn = db.acquire().await.unwrap();
        policies::publish(
            &mut conn,
            &Policy::Tiers(policies::TiersPolicy { count: 6 }),
        )
        .await
        .unwrap();
        let map = crate::maps::MapName::try_from("bhop_badges".to_owned()).unwrap();
        let map_id = crate::maps::id_for(&mut conn, &map).await.unwrap();
        sqlx::query!(
            "INSERT INTO map_tiers (map_id, track, tier) VALUES ($1, 0, 6)",
            map_id
        )
        .execute(&mut *conn)
        .await
        .unwrap();
        drop(conn);
        let lower = Policy::Tiers(policies::TiersPolicy { count: 5 });
        let refused = publish_policy(&db, None, Some(1), &lower, None).await;
        assert!(matches!(refused, Err(ChangeError::Invalid(_))));
    }
}
