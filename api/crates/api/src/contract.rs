//! Checks the example exchanges in `api/contract/` against the API. Every example request is sent through the
//! router and must get the example's status. Every example response must parse into the API's own type and
//! serialize back unchanged, so a renamed, missing or extra field fails here. The plugin's mock server can
//! serve the same files.

use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::{
    anticheat::DetectionAccepted, error::ErrorBody, plugin_releases::PluginRelease,
    record_events::RecordEvents, records::MapRecords,
    records::personal_bests::PlayersPersonalBests, ruleset::Ruleset, runs::RunAccepted,
    servers::heartbeat::HeartbeatResponse, servers::keys, test_client, zones::Zone,
};

type ResponseCheck = fn(&str, &Value);

const EXAMPLES: [(&str, &str, ResponseCheck); 10] = [
    (
        "ruleset",
        include_str!("../../../contract/ruleset.json"),
        round_trips::<Ruleset>,
    ),
    (
        "servers-heartbeat",
        include_str!("../../../contract/servers-heartbeat.json"),
        round_trips::<HeartbeatResponse>,
    ),
    (
        "plugin-latest",
        include_str!("../../../contract/plugin-latest.json"),
        round_trips::<PluginRelease>,
    ),
    (
        "runs",
        include_str!("../../../contract/runs.json"),
        round_trips::<RunAccepted>,
    ),
    (
        "maps-records",
        include_str!("../../../contract/maps-records.json"),
        round_trips::<MapRecords>,
    ),
    (
        "maps-personal-bests",
        include_str!("../../../contract/maps-personal-bests.json"),
        round_trips::<PlayersPersonalBests>,
    ),
    (
        "records-events",
        include_str!("../../../contract/records-events.json"),
        round_trips::<RecordEvents>,
    ),
    (
        "maps-zones",
        include_str!("../../../contract/maps-zones.json"),
        round_trips::<Vec<Zone>>,
    ),
    (
        "anticheat-detections",
        include_str!("../../../contract/anticheat-detections.json"),
        round_trips::<DetectionAccepted>,
    ),
    (
        "error",
        include_str!("../../../contract/error.json"),
        round_trips::<ErrorBody>,
    ),
];

fn round_trips<T: Serialize + DeserializeOwned>(name: &str, example: &Value) {
    let parsed: T = serde_json::from_value(example.clone())
        .unwrap_or_else(|error| panic!("{name}: the example response doesn't parse: {error}"));
    let reserialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(
        &reserialized, example,
        "{name}: the example response has fields the API doesn't"
    );
}

#[sqlx::test]
async fn examples_match_the_api(db: PgPool) {
    // The sample ruleset ranks `normal`, which the run example uses.
    sqlx::raw_sql(include_str!("../../../seed/dev.sql"))
        .execute(&db)
        .await
        .unwrap();
    let key = keys::issue(&db, "Example server").await.unwrap().key;

    for (name, text, check_response) in EXAMPLES {
        let example: Value = serde_json::from_str(text).unwrap();
        check_response(name, &example["response"]);

        if example["method"] == "POST" {
            // The error example shows a keyless request being refused.
            let key = (name != "error").then_some(key.as_str());
            let body = example.get("request").cloned().unwrap_or(json!({}));
            let path = example["path"].as_str().unwrap();
            let response = test_client::post(&db, path, key, &body).await;
            assert_eq!(
                Some(u64::from(response.status)),
                example["status"].as_u64(),
                "{name}: {}",
                String::from_utf8_lossy(&response.body)
            );
        }
    }
}
