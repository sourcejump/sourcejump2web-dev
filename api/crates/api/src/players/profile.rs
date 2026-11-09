//! A player's profile, `GET /v1/players/{player}`: who they are, and per style their rank by points,
//! completions, world records and the first page of their personal bests. A player SourceJump knows only from legacy records
//! has the same profile, with no 2.0 styles and their legacy runs to switch to.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    SteamId64,
    details::{self, PlayerDetails},
    personal_bests::{self, DEFAULT_LIMIT, PersonalBest, Selection, Tracks},
    steam_profile,
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    leaderboards::standings,
    maps::tiers,
};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerProfile {
    /// SteamID64, as a string. Profile URLs should use this form.
    pub steamid64: String,
    /// The name from their latest run, or from Steam if they haven't played yet.
    pub name: String,
    pub avatar_url: Option<String>,
    /// ISO 3166-1 alpha-2: the latest one a game server found for them, the player's pick if they made it
    /// since, or else their Steam profile's. None if none has one.
    pub country_code: Option<String>,
    /// Whether the player picked `country_code` themselves, rather than it coming from a game server or Steam.
    pub country_chosen: bool,
    /// Their setup, as they describe it. None when they've said nothing.
    pub details: Option<PlayerDetails>,
    /// Whether `details` are what they had on the old site, shown until they save their own.
    pub details_from_old_site: bool,
    /// When their first and latest runs finished. None for a player with no runs.
    pub first_run_at: Option<DateTime<Utc>>,
    pub last_run_at: Option<DateTime<Utc>>,
    /// Maps with at least one run, as on the map list: what completed maps are counted out of.
    pub map_count: i64,
    /// One entry per style they hold a personal best in, sorted by style key. Counts are 2.0 alone.
    pub styles: Vec<PlayerStyle>,
    /// The counts across every style: maps and bonus tracks finished in any of them, and every style's world
    /// records added up.
    pub all_styles: StyleTotals,
    /// True while points come from the draft formula, as on `GET /v1/leaderboards`; ranks are a draft too.
    pub points_draft: bool,
    /// Maps they have a legacy run on, none for a player banned from records. When there are any, the
    /// normal style's personal bests have the "2.0 + pre-2.0" and "Pre-2.0" views.
    pub legacy_maps: i64,
    /// Number of tiers in force; None while the community hasn't set tiers, and personal bests then have no
    /// tier.
    pub tier_count: Option<i16>,
}

#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct StyleTotals {
    pub completed_maps: i64,
    pub completed_bonuses: i64,
    pub world_records: i64,
}

/// What the player has done in one style.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerStyle {
    pub style: String,
    /// Maps whose main track they've finished.
    pub completed_maps: i64,
    /// Bonus tracks they've finished, across all maps.
    pub completed_bonuses: i64,
    /// Personal bests that rank first, bonuses included. A tie for first counts for everyone in it.
    pub world_records: i64,
    /// Their place on the style's points leaderboard for main tracks, as `GET /v1/leaderboards/points`
    /// ranks it. None without points there.
    pub main_standing: Option<StyleStanding>,
    /// The same for bonus tracks.
    pub bonus_standing: Option<StyleStanding>,
    /// The first page of main-track personal bests, sorted by map. `GET /v1/players/{player}/personal-bests`
    /// with `tracks=main` continues it; `tracks=bonuses` lists the bonuses.
    pub personal_bests: Vec<PersonalBest>,
    /// Pass as `cursor` for the personal bests after these. None when all are here.
    pub next_cursor: Option<String>,
}

/// A player's place on one points leaderboard. Equal points share a rank.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StyleStanding {
    pub rank: i64,
    /// Rounded, as the leaderboards show them.
    pub points: i64,
}

/// The player's profile. Takes a `SteamID64`, `SteamID2` or `SteamID3`; the answer always carries the `SteamID64`.
#[utoipa::path(
    get,
    path = "/v1/players/{player}",
    tag = "players",
    params(("player" = String, Path, description = "SteamID64, SteamID2 (STEAM_0:1:2) or SteamID3 ([U:1:4])")),
    responses(
        (status = OK, body = PlayerProfile),
        (status = NOT_FOUND, description = "SourceJump has no such player", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID", body = ErrorBody),
    ),
)]
pub async fn player_profile(
    State(state): State<AppState>,
    Path(player): Path<String>,
) -> Result<Json<PlayerProfile>, ApiError> {
    let steamid64 = SteamId64::parse_any(&player)
        .ok_or_else(|| ApiError::Invalid(format!("{player:?} is not a SteamID")))?;

    let player = sqlx::query!(
        r#"
        SELECT name, avatar_url, country_code, country_chosen, steam_profile_fetched_at,
               (SELECT min(finished_at) FROM runs WHERE player_steamid64 = $1 AND invalidated_at IS NULL) AS first_run_at,
               (SELECT max(finished_at) FROM runs WHERE player_steamid64 = $1 AND invalidated_at IS NULL) AS last_run_at
        FROM players WHERE steamid64 = $1
        "#,
        steamid64.get()
    )
    .fetch_optional(&state.db)
    .await?;
    let legacy = sqlx::query!(
        r#"SELECT lp.name, lp.avatar_url, lp.country_code,
                  (SELECT count(*) FROM legacy_personal_bests l WHERE l.player_steamid64 = $1
                   AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = $1)) AS "maps!"
           FROM legacy_players lp WHERE lp.steamid64 = $1"#,
        steamid64.get(),
    )
    .fetch_optional(&state.db)
    .await?;
    let map_count = crate::maps::played_count(&state.db).await?;
    let legacy_maps = legacy.as_ref().map_or(0, |legacy| legacy.maps);
    let shown = details::shown(&mut *state.db.acquire().await?, steamid64).await?;
    let tier_count = tiers::tier_count(&state.db).await?;

    let Some(player) = player else {
        // Known only from the old site: its name, avatar and country as it last had them.
        let legacy = legacy.ok_or(ApiError::NotFound("SourceJump has no such player"))?;
        return Ok(Json(PlayerProfile {
            steamid64: steamid64.to_string(),
            name: legacy.name,
            avatar_url: legacy.avatar_url,
            country_code: legacy.country_code,
            country_chosen: false,
            details: shown.details,
            details_from_old_site: shown.from_old_site,
            first_run_at: None,
            last_run_at: None,
            map_count,
            styles: Vec::new(),
            all_styles: StyleTotals::default(),
            points_draft: standings::formula(&mut *state.db.acquire().await?)
                .await?
                .draft,
            legacy_maps,
            tier_count,
        }));
    };

    steam_profile::refresh_if_stale(
        state.db.clone(),
        state.steam.clone(),
        steamid64,
        player.steam_profile_fetched_at,
    );

    let all_styles = totals(&state.db, steamid64).await?;
    let mut styles = styles_of(&state.db, steamid64, tier_count.is_some()).await?;
    for standing in standings_of(&state.db, steamid64).await? {
        if let Some(style) = styles.iter_mut().find(|s| s.style == standing.style) {
            let place = Some(StyleStanding {
                rank: standing.rank,
                points: standing.points,
            });
            if standing.bonus {
                style.bonus_standing = place;
            } else {
                style.main_standing = place;
            }
        }
    }
    let points_draft = standings::formula(&mut *state.db.acquire().await?)
        .await?
        .draft;

    Ok(Json(PlayerProfile {
        steamid64: steamid64.to_string(),
        name: player.name,
        avatar_url: player.avatar_url,
        country_code: player.country_code,
        country_chosen: player.country_chosen,
        details: shown.details,
        details_from_old_site: shown.from_old_site,
        first_run_at: player.first_run_at,
        last_run_at: player.last_run_at,
        map_count,
        styles,
        all_styles,
        points_draft,
        legacy_maps,
        tier_count,
    }))
}

struct Standing {
    style: String,
    bonus: bool,
    points: i64,
    rank: i64,
}

/// The player's places on the points leaderboards they're on: only with points, as the leaderboards list them.
async fn standings_of(
    db: &sqlx::PgPool,
    steamid64: SteamId64,
) -> Result<Vec<Standing>, sqlx::Error> {
    sqlx::query_as!(
        Standing,
        r#"
        SELECT s.style, s.bonus, round(s.points)::int8 AS "points!",
               -- Ranked on the points shown, as the leaderboards are; the raw comparison keeps to the index.
               1 + (SELECT count(*) FROM standings o
                    WHERE o.style = s.style AND o.bonus = s.bonus AND o.points > s.points
                      AND round(o.points) > round(s.points)) AS "rank!"
        FROM standings s
        WHERE s.player_steamid64 = $1 AND s.points > 0
        "#,
        steamid64.get()
    )
    .fetch_all(db)
    .await
}

/// Counts across every style. A track finished in two styles counts once; a world record in each counts twice.
async fn totals(db: &sqlx::PgPool, steamid64: SteamId64) -> Result<StyleTotals, sqlx::Error> {
    sqlx::query_as!(
        StyleTotals,
        r#"
        SELECT count(DISTINCT map_id) FILTER (WHERE track = 0) AS "completed_maps!",
               count(DISTINCT (map_id, track)) FILTER (WHERE track > 0) AS "completed_bonuses!",
               (SELECT count(*) FROM world_record_holders WHERE player_steamid64 = $1) AS "world_records!"
        FROM personal_bests WHERE player_steamid64 = $1
        "#,
        steamid64.get()
    )
    .fetch_one(db)
    .await
}

/// Each style's counts, read from the stored rows, and its first page of main-track personal bests: the only
/// ones that need a placement worked out.
async fn styles_of(
    db: &sqlx::PgPool,
    steamid64: SteamId64,
    tiers_in_force: bool,
) -> Result<Vec<PlayerStyle>, sqlx::Error> {
    let counts = sqlx::query!(
        r#"
        SELECT pb.style, count(*) FILTER (WHERE pb.track = 0) AS "completed_maps!",
               count(*) FILTER (WHERE pb.track > 0) AS "completed_bonuses!",
               (SELECT count(*) FROM world_record_holders h
                WHERE h.player_steamid64 = $1 AND h.style = pb.style) AS "world_records!"
        FROM personal_bests pb
        WHERE pb.player_steamid64 = $1
        GROUP BY pb.style
        ORDER BY pb.style
        "#,
        steamid64.get()
    )
    .fetch_all(db)
    .await?;
    let page_size = usize::try_from(DEFAULT_LIMIT).expect("positive");
    let mut styles = Vec::with_capacity(counts.len());
    for count in counts {
        let selection = Selection {
            style: Some(&count.style),
            tracks: Some(Tracks::Main),
            ..Selection::default()
        };
        let first_page = personal_bests::personal_bests(
            db,
            steamid64,
            selection,
            None,
            Some(DEFAULT_LIMIT + 1),
            tiers_in_force,
        )
        .await?;
        let (personal_bests, next_cursor) =
            personal_bests::split_page(first_page, page_size, false);
        styles.push(PlayerStyle {
            style: count.style,
            completed_maps: count.completed_maps,
            completed_bonuses: count.completed_bonuses,
            world_records: count.world_records,
            main_standing: None,
            bonus_standing: None,
            personal_bests,
            next_cursor,
        });
    }
    Ok(styles)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        maps::MapName,
        policies::{Policy, TiersPolicy},
        runs::tests::{run, setup},
        staff, test_client,
    };

    const SECOND: &str = "76561197960287931";

    #[sqlx::test]
    async fn shows_personal_bests_with_placements(db: PgPool) {
        let key = setup(&db).await;
        let mut faster = run("b", 20.0);
        faster["player"] = json!({ "steamid64": SECOND, "name": "second" });
        // A second ruleset version that also ranks sideways.
        sqlx::query(
            r#"INSERT INTO rulesets (version, document)
               SELECT 2, jsonb_set(document, '{styles}', document->'styles' || '[{"key": "sw", "name": "Sideways", "settings": {}}]')
               FROM rulesets WHERE version = 1"#,
        )
        .execute(&db)
        .await
        .unwrap();
        crate::runs::tests::backdate(&db).await;
        let mut sideways = run("c", 40.0);
        sideways["style"] = json!("sw");
        sideways["ruleset_version"] = json!(2);
        for body in [&run("a", 30.0), &faster, &sideways] {
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), body)
                    .await
                    .status,
                201
            );
        }

        let mut bonus = run("d", 10.0);
        bonus["track"] = json!(1);
        assert_eq!(
            test_client::post(&db, "/v1/runs", Some(&key), &bonus)
                .await
                .status,
            201
        );

        let profile: PlayerProfile = test_client::get(&db, "/v1/players/STEAM_0:0:11101")
            .await
            .json();

        assert_eq!(profile.steamid64, "76561197960287930");
        assert_eq!(profile.name, "gabe");
        assert_eq!(profile.map_count, 1);
        // Across styles, bhop_badges counts once; its world records in sw and on the normal bonus add up.
        let all = &profile.all_styles;
        assert_eq!(
            (all.completed_maps, all.completed_bonuses, all.world_records),
            (1, 1, 2)
        );
        let styles: Vec<_> = profile
            .styles
            .iter()
            .map(|s| {
                let pbs: Vec<_> = s
                    .personal_bests
                    .iter()
                    .map(|pb| (pb.map.as_str(), pb.track, pb.rank, pb.time))
                    .collect();
                (
                    s.style.as_str(),
                    s.completed_maps,
                    s.completed_bonuses,
                    s.world_records,
                    pbs,
                )
            })
            .collect();
        assert_eq!(
            styles,
            [
                (
                    "normal",
                    1,
                    1,
                    1,
                    // Bonuses are counted, but listed on their own (`tracks=bonuses`).
                    vec![("bhop_badges", 0, Some(2), 30.0)]
                ),
                ("sw", 1, 0, 1, vec![("bhop_badges", 0, Some(1), 40.0)]),
            ]
        );
        assert!(profile.styles.iter().all(|s| s.next_cursor.is_none()));
        assert!(profile.first_run_at.is_some() && profile.last_run_at.is_some());
    }

    #[sqlx::test]
    async fn ranks_each_style_by_points_once_tracks_have_tiers(db: PgPool) {
        let key = setup(&db).await;
        let mut faster = run("b", 20.0);
        faster["player"] = json!({ "steamid64": SECOND, "name": "second" });
        for body in [&run("a", 30.0), &faster] {
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), body)
                    .await
                    .status,
                201
            );
        }
        let main_standing = |profile: &PlayerProfile| {
            profile.styles[0]
                .main_standing
                .as_ref()
                .map(|standing| standing.rank)
        };
        let profile: PlayerProfile = test_client::get(&db, "/v1/players/76561197960287930")
            .await
            .json();
        assert_eq!(main_standing(&profile), None, "no points without tiers");
        assert_eq!(profile.tier_count, None);
        assert_eq!(profile.styles[0].personal_bests[0].tier, None);

        staff::policies::publish_policy(
            &db,
            None,
            None,
            &Policy::Tiers(TiersPolicy { count: 5 }),
            None,
        )
        .await
        .unwrap();
        let map = MapName::try_from("bhop_badges".to_owned()).unwrap();
        staff::maps::set_tier(&db, None, &map, 0, 1).await.unwrap();

        for (player, rank) in [("76561197960287930", 2), (SECOND, 1)] {
            let profile: PlayerProfile = test_client::get(&db, &format!("/v1/players/{player}"))
                .await
                .json();
            assert_eq!(main_standing(&profile), Some(rank), "{player}");
            assert_eq!(profile.tier_count, Some(5));
            assert_eq!(profile.styles[0].personal_bests[0].tier, Some(1));
            // The record holder's own time, the faster time for the player behind.
            assert_eq!(
                profile.styles[0].personal_bests[0].world_record_time,
                Some(20.0)
            );
            assert!(profile.styles[0].bonus_standing.is_none());
            assert!(profile.points_draft);
        }
    }

    #[sqlx::test]
    async fn unknown_players_and_bad_ids(db: PgPool) {
        assert_eq!(
            test_client::get(&db, "/v1/players/76561197960287930")
                .await
                .status,
            404
        );
        assert_eq!(test_client::get(&db, "/v1/players/nova").await.status, 422);
    }
}
