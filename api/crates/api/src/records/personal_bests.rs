//! Players' personal bests on one map, `GET /v1/maps/{map}/personal-bests?players=`: what a game server reads
//! on map change for everyone connected, so it skips submitting runs that aren't faster than the player's
//! SourceJump PB (`docs/domain.md`). One request covers every player, style and track, instead of one per
//! leaderboard.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::MapName,
    players::SteamId64,
};

/// A server holds at most 64 players, so one request covers everyone on it.
const MAX_PLAYERS: usize = 64;

#[derive(Debug, Deserialize, IntoParams)]
pub struct PersonalBestsQuery {
    /// Players by SteamID64, comma-separated: 1 to 64 of them. Repeats count once.
    players: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayersPersonalBests {
    pub map: String,
    /// Sorted by player, style and track. A player with no personal best on the map has no entries. One flat
    /// list keeps it simple to read in SourcePawn.
    pub personal_bests: Vec<PlayerPersonalBest>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerPersonalBest {
    /// SteamID64, as a string.
    pub steamid64: String,
    pub style: String,
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i16,
    /// Seconds.
    pub time: f64,
    /// Place on the leaderboard; equal times share a place, as in `…/records`.
    pub rank: i64,
    pub run_id: i64,
    pub finished_at: DateTime<Utc>,
}

/// These players' SourceJump personal bests on the map, every style and track. An unknown map, or players
/// without runs on it, give an empty list.
#[utoipa::path(
    get,
    path = "/v1/maps/{map}/personal-bests",
    tag = "maps",
    params(("map" = String, Path, description = "Map name"), PersonalBestsQuery),
    responses(
        (status = OK, body = PlayersPersonalBests),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name, or `players` isn't 1 to 64 SteamID64s", body = ErrorBody),
    ),
)]
pub async fn players_personal_bests(
    State(state): State<AppState>,
    Path(map): Path<String>,
    Query(query): Query<PersonalBestsQuery>,
) -> Result<Json<PlayersPersonalBests>, ApiError> {
    let map = MapName::try_from(map).map_err(ApiError::Invalid)?;
    let players = parse_players(&query.players).map_err(ApiError::Invalid)?;

    // A place is one more than the faster personal bests on the board, read from its index; a slow player on a
    // big board counts more entries, but never more than the board holds.
    let personal_bests = sqlx::query_as!(
        PlayerPersonalBest,
        r#"
        SELECT pb.player_steamid64::text AS "steamid64!", pb.style, pb.track, pb.time, pb.run_id,
               pb.finished_at,
               1 + (SELECT count(*) FROM personal_bests faster
                    WHERE faster.map_id = pb.map_id AND faster.style = pb.style AND faster.track = pb.track
                      AND faster.time < pb.time) AS "rank!"
        FROM personal_bests pb
        JOIN maps m ON m.id = pb.map_id
        WHERE m.name = $1 AND pb.player_steamid64 = ANY($2)
        ORDER BY pb.player_steamid64, pb.style, pb.track
        "#,
        map.as_str(),
        &players
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(PlayersPersonalBests {
        map: map.into(),
        personal_bests,
    }))
}

/// Each player named in `players`, once.
fn parse_players(players: &str) -> Result<Vec<i64>, String> {
    let mut parsed = Vec::new();
    for text in players.split(',') {
        let steamid64 = SteamId64::try_from(text.trim().to_owned())?.get();
        if !parsed.contains(&steamid64) {
            parsed.push(steamid64);
        }
    }
    if parsed.len() > MAX_PLAYERS {
        return Err(format!("players takes at most {MAX_PLAYERS} SteamID64s"));
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::{MAX_PLAYERS, PlayersPersonalBests, parse_players};
    use crate::{
        error::ErrorBody,
        runs::tests::{run, setup},
        test_client,
    };

    const GABE: &str = "76561197960287930";
    const SECOND: &str = "76561197960287931";
    const THIRD: &str = "76561197960287932";

    #[sqlx::test]
    async fn lists_each_players_bests_with_their_place(db: PgPool) {
        let key = setup(&db).await;
        let mut second = run("b", 29.0);
        second["player"] = json!({ "steamid64": SECOND, "name": "second" });
        let mut third = run("c", 29.0);
        third["player"] = json!({ "steamid64": THIRD, "name": "third" });
        let mut bonus = run("d", 50.0);
        bonus["track"] = json!(1);
        let mut elsewhere = run("e", 10.0);
        elsewhere["map"] = json!("bhop_other");
        for body in [run("a", 30.0), second, third, bonus, elsewhere] {
            let status = test_client::post(&db, "/v1/runs", Some(&key), &body)
                .await
                .status;
            assert_eq!(status, 201);
        }

        let answer: PlayersPersonalBests = test_client::get(
            &db,
            &format!("/v1/maps/bhop_badges/personal-bests?players={GABE},{THIRD},{GABE}"),
        )
        .await
        .json();

        assert_eq!(answer.map, "bhop_badges");
        let summary: Vec<_> = answer
            .personal_bests
            .iter()
            .map(|pb| (pb.steamid64.as_str(), pb.track, pb.time, pb.rank))
            .collect();
        // The two 29s share first place; the 30 is third. The run on another map isn't listed.
        assert_eq!(
            summary,
            [(GABE, 0, 30.0, 3), (GABE, 1, 50.0, 1), (THIRD, 0, 29.0, 1)]
        );
    }

    #[sqlx::test]
    async fn an_unknown_map_or_a_player_without_runs_gives_an_empty_list(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;

        for path in [
            format!("/v1/maps/bhop_none/personal-bests?players={GABE}"),
            format!("/v1/maps/bhop_badges/personal-bests?players={SECOND}"),
        ] {
            let answer: PlayersPersonalBests = test_client::get(&db, &path).await.json();
            assert!(answer.personal_bests.is_empty(), "{path}");
        }
    }

    #[sqlx::test]
    async fn refuses_anything_but_1_to_64_steamid64s(db: PgPool) {
        let too_many = (0..=MAX_PLAYERS as u64)
            .map(|n| (76_561_197_960_287_930 + n).to_string())
            .collect::<Vec<_>>()
            .join(",");
        for players in ["", "STEAM_0:0:1", "76561197960287930,,", too_many.as_str()] {
            let response = test_client::get(
                &db,
                &format!("/v1/maps/bhop_badges/personal-bests?players={players}"),
            )
            .await;
            assert_eq!(response.status, 422, "{players}");
            let _: ErrorBody = response.json();
        }
        assert_eq!(
            test_client::get(&db, "/v1/maps/bhop_badges/personal-bests")
                .await
                .status,
            400,
            "players is required"
        );
    }

    #[test]
    fn repeats_count_once() {
        assert_eq!(
            parse_players("76561197960287930, 76561197960287930").unwrap(),
            [76_561_197_960_287_930]
        );
    }
}
