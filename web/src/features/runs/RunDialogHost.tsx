"use client";
// The run dialog, over whichever page is open. It opens the moment a run link is clicked and loads the run
// inside, so the page behind never reloads (lead, 2026-10-19). It shows what everyone sees; staff act on the
// run on its own page. Pre-2.0 runs open in it too, with what the old site kept; they have no run page.
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { ArrowRight, Play } from "lucide-react";
import { LegacyRunDetailList } from "@/features/legacy/LegacyRunDetailList";
import { REPLAY_ANCHOR } from "@/features/replays/anchor";
import { Button, ButtonLink } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Tooltip } from "@/ui/Tooltip";
import { loadGapWhenFinished } from "./loadGapWhenFinished";
import { RunDetailList } from "./RunDetailList";
import { closeRun, PRE_RUN_PARAM, REPLAY_PARAM, RUN_PARAM } from "./runDialog";

// The viewer is large, so it loads only once a replay is opened, not with every page.
const ReplayPlayer = dynamic(
  () => import("@/features/replays/ReplayPlayer").then((m) => m.ReplayPlayer),
  { ssr: false },
);

type Run =
  | { legacy: false; run: Schemas["RunDetail"]; gap: number | null }
  | { legacy: true; run: Schemas["LegacyRunDetail"] };
type Loaded = { key: string } & (Run | { error: string });

/** Style names change rarely, so the browser asks for the ruleset once per visit. */
let styleNames: Promise<Map<string, string>> | undefined;
function loadStyleNames() {
  styleNames ??= api
    .GET("/v1/ruleset")
    .then(
      (result) =>
        new Map(result.data?.styles.map((style) => [style.key, style.name])),
    )
    .catch(() => new Map<string, string>());
  return styleNames;
}

const FAILED = "This run couldn't be loaded. Try again in a moment.";

async function loadRun(id: string, legacy: boolean): Promise<Run | string> {
  const path = { params: { path: { id: Number(id) } } };
  const result = legacy
    ? await api.GET("/v1/legacy-runs/{id}", path)
    : await api.GET("/v1/runs/{id}", path);
  if (!result.data) {
    return result.response.status === 404
      ? "SourceJump has no such run."
      : FAILED;
  }
  if (legacy) {
    return { legacy: true, run: result.data as Schemas["LegacyRunDetail"] };
  }
  const run = result.data as Schemas["RunDetail"];
  // Against the record standing when it finished, as on Activity and the run's page.
  return { legacy: false, run, gap: await loadGapWhenFinished(run) };
}

export function RunDialogHost() {
  const params = useSearchParams();
  const runId = params.get(RUN_PARAM);
  const replayId = params.get(REPLAY_PARAM);
  const preRunId = params.get(PRE_RUN_PARAM);
  const id = runId ?? replayId ?? preRunId;
  const replay = runId == null && replayId != null;
  const legacy = runId == null && replayId == null && preRunId != null;
  const key = id && `${legacy ? "pre" : replay ? "replay" : "run"}-${id}`;
  const [loaded, setLoaded] = useState<Loaded>();
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!id || !key) return;
    let current = true;
    void loadStyleNames().then((result) => current && setNames(result));
    loadRun(id, legacy)
      .catch(() => FAILED)
      .then((result) => {
        if (!current) return;
        setLoaded(
          typeof result === "string"
            ? { key, error: result }
            : { key, ...result },
        );
      });
    return () => {
      current = false;
    };
  }, [id, key, legacy]);

  if (!id) return null;
  const shown = loaded?.key === key ? loaded : undefined;
  const run = shown && "run" in shown ? shown : undefined;

  if (replay) {
    return (
      <Dialog
        open
        size="lg"
        onClose={closeRun}
        title={run ? `${run.run.player.name} on ${run.run.map}` : "Replay"}
        footer={
          <ButtonLink href={`/runs/${id}`} size="sm" variant="ghost">
            Run page
            <ArrowRight aria-hidden />
          </ButtonLink>
        }
      >
        {!shown ? null : run && !run.legacy ? (
          run.run.replay ? (
            <ReplayPlayer
              run={run.run}
              styleNames={Object.fromEntries(names)}
              startNow
            />
          ) : (
            <p className="text-text-muted">This run has no replay.</p>
          )
        ) : (
          <p className="text-text-muted">{"error" in shown && shown.error}</p>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={closeRun}
      title={run ? `${run.run.player.name} on ${run.run.map}` : "Run"}
      footer={
        legacy ? (
          // Grayed out rather than gone, so the dialog reads the same as a 2.0 run's.
          <Tooltip content="Pre-2.0 runs have no run page.">
            <span tabIndex={0}>
              <Button size="sm" variant="ghost" disabled>
                Run page
                <ArrowRight aria-hidden />
              </Button>
            </span>
          </Tooltip>
        ) : (
          <>
            {run && !run.legacy && run.run.replay && (
              <ButtonLink
                href={`/runs/${id}#${REPLAY_ANCHOR}`}
                size="sm"
                variant="secondary"
              >
                <Play aria-hidden />
                Watch replay
              </ButtonLink>
            )}
            <ButtonLink href={`/runs/${id}`} size="sm" variant="ghost">
              Run page
              <ArrowRight aria-hidden />
            </ButtonLink>
          </>
        )
      }
    >
      {!shown ? null : run ? (
        run.legacy ? (
          <LegacyRunDetailList
            run={run.run}
            styleName={names.get("normal") ?? "Normal"}
          />
        ) : (
          <RunDetailList
            run={run.run}
            gap={run.gap}
            styleName={names.get(run.run.style) ?? run.run.style}
          />
        )
      ) : (
        <p className="text-text-muted">{"error" in shown && shown.error}</p>
      )}
    </Dialog>
  );
}
