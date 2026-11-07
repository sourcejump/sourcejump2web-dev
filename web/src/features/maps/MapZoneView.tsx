"use client";
// A map's zones in 3D, shown on asking, as a run's replay is: until then a poster of the map with a button, so
// nothing heavy loads with the page. Hiding it, or leaving the page, unloads the view. A map without a file for
// the 3D view yet shows its zones from above instead.
import { Box, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Schemas } from "@/api/client";
import { ZoneEditor } from "@/features/staff/maps/ZoneEditor";
import { ZonePlan } from "@/features/staff/maps/ZonePlan";
import { Button } from "@/ui/Button";

export function MapZoneView({
  map,
  zones,
  viewerFile,
  tracks,
  cover,
}: {
  map: string;
  zones: Schemas["Zone"][];
  /** Null when the map has no file for the 3D view yet; the plan shows instead. */
  viewerFile: Schemas["ViewerFile"] | null;
  tracks: number[];
  /** The map's cover picture, for the poster. */
  cover: Schemas["MapImage"] | undefined;
}) {
  const [shown, setShown] = useState(false);
  // Next keeps a page left behind alive but hidden, and tears down its effects; back on it, the poster shows
  // again rather than the 3D view, as the replay player does.
  useEffect(() => () => setShown(false), []);

  if (!viewerFile) {
    return (
      <>
        <p className="text-text-subtle text-sm">
          No 3D view yet: staff haven&apos;t uploaded this map&apos;s file.
        </p>
        <ZonePlan zones={zones} />
      </>
    );
  }

  if (!shown) {
    return (
      <div className="border-border bg-surface relative flex aspect-video items-center justify-center overflow-hidden rounded-md border">
        {cover && (
          // The map's picture, dimmed, so the space reads as this map until the view loads. Decorative only.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.url}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover opacity-25 blur-sm"
          />
        )}
        <Button
          variant="primary"
          className="relative"
          onClick={() => setShown(true)}
        >
          <Box aria-hidden />
          View in 3D
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" className="self-start" onClick={() => setShown(false)}>
        <X aria-hidden />
        Hide 3D view
      </Button>
      <ZoneEditor
        map={map}
        zones={zones}
        edit={null}
        viewerFile={viewerFile}
        tracks={tracks}
      />
    </>
  );
}
