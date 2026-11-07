"use client";
// Move banner, over the banner on a map's Manage view: a dialog shows the whole cover with the strip the
// banner shows of it, and a slider moves the strip. Pictures themselves are managed in the Images card.
import { MoveVertical } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api, type Schemas } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { useStaffAction } from "../useStaffAction";

/**
 * About how much of a picture's height the banner shows on a wide screen (192px of a 16:9 picture 1120px
 * wide). Phones show more of it, so the strip drawn here is the least that's seen.
 */
const BANNER_SHARE = 0.3;

export function CoverControls({
  map,
  cover,
}: {
  map: string;
  cover: Schemas["MapImage"];
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const action = useStaffAction();
  const managing = usePathname().endsWith("/manage");
  if (!managing) return null;

  function close() {
    setFocus(null);
    action.clearError();
  }

  async function save() {
    if (focus === null) return;
    const done = await action.run(
      () =>
        api.PUT("/v1/staff/maps/{map}/images/{id}/focus", {
          params: { path: { map, id: cover.id } },
          body: { focus },
        }),
      "The banner couldn't be moved. Try again.",
    );
    if (done) close();
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => setFocus(cover.focus)}
        className="motion-enter absolute top-3 right-3"
      >
        <MoveVertical aria-hidden />
        Move banner
      </Button>
      <Dialog
        open={focus !== null}
        onClose={close}
        title="Move the banner"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={action.busy}>
              {action.busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {focus !== null && (
          <div className="flex flex-col gap-3">
            <p className="text-text-muted text-sm">
              The bright strip is what the map page&apos;s banner shows of the
              cover.
            </p>
            <BannerPreview src={cover.url} focus={focus} />
            <label className="flex flex-col gap-1.5 text-sm">
              Banner position
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={focus}
                onChange={(event) => setFocus(Number(event.target.value))}
                className="accent-accent"
                data-autofocus
              />
            </label>
            {action.error && (
              <p className="text-danger text-sm">{action.error}</p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

/** The whole picture, with what's outside the banner's strip shaded. */
function BannerPreview({ src, focus }: { src: string; focus: number }) {
  const hidden = (1 - BANNER_SHARE) * 100;
  return (
    <div className="border-border relative aspect-video overflow-hidden rounded-md border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" />
      <div
        className="bg-bg/70 absolute inset-x-0 top-0"
        style={{ height: `${(hidden * focus) / 100}%` }}
      />
      <div
        className="bg-bg/70 absolute inset-x-0 bottom-0"
        style={{ height: `${(hidden * (100 - focus)) / 100}%` }}
      />
    </div>
  );
}
