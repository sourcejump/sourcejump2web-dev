"use client";
// Bans a player: what from (none start ticked, so staff choose each one), until when, whether their existing
// runs go too (on by default, lead 2026-10-20), and why.
import { Gavel } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useStaffAction } from "../useStaffAction";
import { restrictionLabels } from "./restrictions";

type Restriction = Schemas["Restriction"];
const RESTRICTIONS = Object.keys(restrictionLabels) as Restriction[];

export function BanPlayer({
  player,
  validRuns,
}: {
  player: Schemas["PlayerRef"];
  /** Their valid runs, for the option to invalidate them; 0 when the staff member can't invalidate runs. */
  validRuns: number;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Restriction[]>([]);
  const [endsOn, setEndsOn] = useState("");
  const [timed, setTimed] = useState(false);
  const [invalidate, setInvalidate] = useState(true);
  const [reason, setReason] = useState("");
  const action = useStaffAction();
  const formId = useId();
  const records = chosen.includes("no_records");
  const offerInvalidate = records && validRuns > 0;

  function toggle(restriction: Restriction, on: boolean) {
    setChosen((current) =>
      on
        ? RESTRICTIONS.filter((r) => r === restriction || current.includes(r))
        : current.filter((r) => r !== restriction),
    );
  }

  function close() {
    setOpen(false);
    action.clearError();
  }

  async function ban(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(
      () =>
        api.POST("/v1/staff/players/{player}/bans", {
          params: { path: { player: player.steamid64 } },
          body: {
            restrictions: chosen,
            reason,
            // The ban ends as the chosen day starts in UTC, the time zone the site shows dates in.
            ends_at: timed && endsOn ? `${endsOn}T00:00:00Z` : null,
            invalidate_runs: offerInvalidate && invalidate,
          },
        }),
      "The ban couldn't be saved. Try again.",
    );
    if (done) {
      setOpen(false);
      setChosen([]);
      setReason("");
      setEndsOn("");
      setTimed(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Gavel aria-hidden />
        Ban player
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Ban ${player.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={action.busy || chosen.length === 0}
            >
              {action.busy ? "Banning…" : "Ban"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={ban} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1.5">Restrictions</legend>
            <div className="flex flex-wrap gap-4">
              {RESTRICTIONS.map((restriction) => (
                <label key={restriction} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chosen.includes(restriction)}
                    onChange={(event) =>
                      toggle(restriction, event.target.checked)
                    }
                    className="accent-accent size-4"
                  />
                  {restrictionLabels[restriction]}
                </label>
              ))}
            </div>
            <p className="text-text-muted">
              {records
                ? "Records: their new runs are stored invalid and stay off the boards. "
                : ""}
              {chosen.includes("no_posting")
                ? "Posting: they can't write or change community posts; existing posts stay up. "
                : ""}
              {chosen.includes("no_profile_edits")
                ? "Profile details: they can't change their setup or country; what's there stays until staff change it."
                : ""}
            </p>
          </fieldset>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1.5">Ends</legend>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${formId}-ends`}
                  checked={!timed}
                  onChange={() => setTimed(false)}
                  className="accent-accent size-4"
                />
                When lifted
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${formId}-ends`}
                  checked={timed}
                  onChange={() => setTimed(true)}
                  className="accent-accent size-4"
                />
                On
              </label>
              <Input
                type="date"
                aria-label="End date"
                value={endsOn}
                onChange={(event) => {
                  setEndsOn(event.target.value);
                  setTimed(true);
                }}
                required={timed}
                className="w-44"
              />
            </div>
          </fieldset>
          {offerInvalidate && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={invalidate}
                onChange={(event) => setInvalidate(event.target.checked)}
                className="accent-accent size-4"
              />
              Also invalidate their {validRuns.toLocaleString("en")} valid{" "}
              {validRuns === 1 ? "run" : "runs"}
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm">
            Reason, for staff only
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              required
              data-autofocus
            />
          </label>
          {action.error && (
            <p className="text-danger text-sm">{action.error}</p>
          )}
        </form>
      </Dialog>
    </>
  );
}
