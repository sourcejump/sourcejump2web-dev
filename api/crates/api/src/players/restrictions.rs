//! What a banned player may not do: restriction bits, stored as a bitmap in `bans.restrictions`, and the
//! restrictions a player's active bans add up to.
//!
//! Sensitive path, fails closed. Same rules as privileges: a bit's position is its stored meaning and is never
//! renumbered or reused; bits no restriction defines are ignored when read; outside the database restrictions
//! travel as names.

use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use utoipa::ToSchema;

use super::SteamId64;

/// One restriction. The discriminant is the bit position in `bans.restrictions`.
// The names are what the API sends ("no_records"), so they keep their shared prefix.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Restriction {
    /// Runs are stored invalid: off every board, and no replay is asked for.
    NoRecords = 0,
    /// May not write, change or remove community posts or run comments.
    NoPosting = 1,
    /// May not change their own profile details (`details.rs`); what's there stays until staff change it.
    NoProfileEdits = 2,
}

impl Restriction {
    pub const ALL: [Self; 3] = [Self::NoRecords, Self::NoPosting, Self::NoProfileEdits];

    pub fn bit(self) -> i64 {
        1 << (self as u32)
    }
}

/// A set of restrictions, read from or written to a bitmap column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Restrictions(i64);

impl Restrictions {
    /// Reads a stored bitmap. Bits no restriction defines are dropped.
    pub fn from_bits(bits: i64) -> Self {
        Self(bits & Self::of(&Restriction::ALL).0)
    }

    pub fn of(restrictions: &[Restriction]) -> Self {
        Self(restrictions.iter().fold(0, |bits, r| bits | r.bit()))
    }

    pub fn bits(self) -> i64 {
        self.0
    }

    pub fn contains(self, restriction: Restriction) -> bool {
        self.0 & restriction.bit() != 0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub fn list(self) -> Vec<Restriction> {
        Restriction::ALL
            .into_iter()
            .filter(|&restriction| self.contains(restriction))
            .collect()
    }
}

/// What the player's active bans restrict, together. Which bans are active is the `active_bans` view's rule,
/// and the queries that leave banned players off the boards read `records_bans` (migration 0047).
pub async fn active(
    conn: &mut PgConnection,
    player: SteamId64,
) -> Result<Restrictions, sqlx::Error> {
    let bits = sqlx::query_scalar!(
        r#"SELECT coalesce(bit_or(restrictions), 0) AS "bits!" FROM active_bans WHERE player_steamid64 = $1"#,
        player.get()
    )
    .fetch_one(conn)
    .await?;
    Ok(Restrictions::from_bits(bits))
}

/// The staff log entry of the newest active ban that keeps this player off the boards, if any. The ingest
/// stores the run invalid in its name.
///
/// Locks the player's row (shared) first: banning takes it exclusively, so a run and a ban arriving together
/// are ordered. Either the ban commits first and this sees it, or the run does and the ban's invalidation of
/// existing runs takes it.
pub async fn records_ban(
    conn: &mut PgConnection,
    player: SteamId64,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query!(
        "SELECT 1 AS locked FROM players WHERE steamid64 = $1 FOR SHARE",
        player.get()
    )
    .fetch_optional(&mut *conn)
    .await?;
    sqlx::query_scalar!(
        r#"SELECT log_id AS "log_id!" FROM records_bans
           WHERE player_steamid64 = $1 ORDER BY banned_at DESC, id DESC LIMIT 1"#,
        player.get()
    )
    .fetch_optional(conn)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_bits_restrict_nothing() {
        let read = Restrictions::from_bits(0b1 | 1 << 40);
        assert_eq!(read.list(), [Restriction::NoRecords]);
        assert_eq!(Restrictions::of(&Restriction::ALL).bits(), 0b111);
    }

    /// `records_bans` spells out `no_records`'s bit itself (migration 0047), so it has to agree with this file.
    #[sqlx::test]
    async fn records_bans_are_the_active_no_records_ones(db: sqlx::PgPool) {
        // By player: in force; another restriction; ended yesterday; lifted. Ends are from now.
        let bans = [
            (1, Restriction::NoRecords, Some("1 day"), false),
            (2, Restriction::NoPosting, None, false),
            (3, Restriction::NoRecords, Some("-1 day"), false),
            (4, Restriction::NoRecords, None, true),
        ];
        for (player, restriction, ends_in, lifted) in bans {
            sqlx::query(
                "
                WITH player AS (
                    INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1, 'p', '-infinity')
                ), entry AS (
                    INSERT INTO staff_log (action, target, reason) VALUES ('ban_player', $1::text, 'x') RETURNING id
                )
                INSERT INTO bans (player_steamid64, restrictions, reason, banned_at, ends_at, log_id,
                                  lifted_at, lift_reason)
                SELECT $1, $2, 'x', now() - interval '2 days', now() + $3::interval, id,
                       CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN 'x' END
                FROM entry
                ",
            )
            .bind(player)
            .bind(restriction.bit())
            .bind(ends_in)
            .bind(lifted)
            .execute(&db)
            .await
            .unwrap();
        }
        let banned: Vec<i64> =
            sqlx::query_scalar("SELECT player_steamid64 FROM records_bans ORDER BY 1")
                .fetch_all(&db)
                .await
                .unwrap();
        assert_eq!(banned, [1]);
    }
}
