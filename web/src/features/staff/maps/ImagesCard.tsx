"use client";
// A map's pictures on its Manage view, for staff who hold manage_maps: up to 10 in order, the first being the
// cover. Add images takes several files at once and uploads them one by one; the API crops, resizes and
// compresses each. Dragging a picture, the arrows and Make cover rearrange a draft order that's saved with
// Save order, so trying out an order posts nothing (each saved order is logged and announced on Discord).
// Remove asks first.
import { ChevronLeft, ChevronRight, ImageUp, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type PointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, failureMessage, type Schemas } from "@/api/client";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { useStaffAction } from "../useStaffAction";

const MAX_IMAGES = 10;
/** The API's limit; checked here too, so a big file fails before it's sent. */
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

type Image = Schemas["MapImage"];

/** The pictures in the draft's order. Pictures added since the draft began go last; removed ones drop out. */
function inOrder(images: Image[], draft: number[] | null): Image[] {
  if (!draft) return images;
  const byId = new Map(images.map((image) => [image.id, image]));
  const drafted = draft.flatMap((id) => byId.get(id) ?? []);
  return [...drafted, ...images.filter((image) => !draft.includes(image.id))];
}

/**
 * Slides tiles from where they were to where they are now after the order changes, so a drag reads as the
 * pictures making room rather than jumping. Skipped when the visitor prefers reduced motion.
 *
 * `idAt` finds the tile under a point by where each tile settles, not where it's drawn mid-slide: hit-testing
 * the moving tiles would pick whichever slid under the pointer and swap them back and forth.
 */
function useSlideIntoPlace(order: string) {
  const tiles = useRef(new Map<number, HTMLElement>());
  // Page coordinates, so they hold while the page scrolls during a drag.
  const settled = useRef(new Map<number, DOMRect>());
  useLayoutEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const now = new Map<number, DOMRect>();
    for (const [id, tile] of tiles.current) {
      // A slide still running would skew the measurement, so it's ended first.
      for (const animation of tile.getAnimations()) animation.cancel();
      const rect = tile.getBoundingClientRect();
      const onPage = new DOMRect(
        rect.left + window.scrollX,
        rect.top + window.scrollY,
        rect.width,
        rect.height,
      );
      now.set(id, onPage);
      const before = settled.current.get(id);
      if (reduced || !before) continue;
      const dx = before.left - onPage.left;
      const dy = before.top - onPage.top;
      if (dx === 0 && dy === 0) continue;
      tile.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
    settled.current = now;
  }, [order]);

  function idAt(clientX: number, clientY: number): number | null {
    const x = clientX + window.scrollX;
    const y = clientY + window.scrollY;
    for (const [id, rect] of settled.current) {
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      )
        return id;
    }
    return null;
  }

  const tile = (id: number) => (element: HTMLElement | null) => {
    if (element) tiles.current.set(id, element);
    else tiles.current.delete(id);
  };
  return { tile, idAt };
}

export function ImagesCard({ map, images }: { map: string; images: Image[] }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Image | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const action = useStaffAction();
  const room = MAX_IMAGES - images.length;
  const shown = inOrder(images, draft);
  const order = shown.map((image) => image.id).join(",");
  const unsaved = order !== images.map((image) => image.id).join(",");
  // Dropped once the page's data holds the same order, not when Save answers: the refreshed data comes a
  // moment later, and dropping it sooner would slide the pictures back to the old order and forward again.
  if (draft && !unsaved) setDraft(null);
  const slide = useSlideIntoPlace(order);

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    const found: string[] = [];
    if (files.length > room) {
      found.push(
        `Only ${room} more ${room === 1 ? "fits" : "fit"}; the rest weren't added.`,
      );
    }
    const chosen = files.slice(0, room);
    for (const [index, file] of chosen.entries()) {
      setUploading(`Uploading ${index + 1} of ${chosen.length}…`);
      if (!TYPES.includes(file.type)) {
        found.push(`${file.name}: choose a PNG, JPEG or WebP image.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        found.push(`${file.name}: the image is over 15 MB.`);
        continue;
      }
      const result = await api
        .POST("/v1/staff/maps/{map}/images", {
          params: { path: { map } },
          // The schema types a binary body as a string; the file itself is what's sent.
          body: file as unknown as string,
          bodySerializer: (body) => body as unknown as BodyInit,
          headers: { "content-type": file.type },
        })
        .catch(() => undefined);
      if (!result?.response.ok) {
        found.push(
          `${file.name}: ${failureMessage(result?.error, "it couldn't be uploaded. Try again.")}`,
        );
      }
    }
    setUploading(null);
    setProblems(found);
    router.refresh();
  }

  async function saveOrder() {
    await action.run(
      () =>
        api.PUT("/v1/staff/maps/{map}/images/order", {
          params: { path: { map } },
          body: { images: shown.map((image) => image.id) },
        }),
      "The order couldn't be saved. Try again.",
    );
  }

  function move(index: number, by: number) {
    const ids = shown.map((image) => image.id);
    const [id] = ids.splice(index, 1);
    if (id === undefined) return;
    ids.splice(index + by, 0, id);
    setDraft(ids);
  }

  function startDrag(event: PointerEvent<HTMLElement>, id: number) {
    if (event.button !== 0 || action.busy) return;
    // Captured, so the drag keeps going when the pointer leaves the tile or the grid.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
  }

  function drag(event: PointerEvent<HTMLElement>) {
    if (dragging === null) return;
    const target = slide.idAt(event.clientX, event.clientY);
    if (target === null || target === dragging) return;
    const from = shown.findIndex((image) => image.id === dragging);
    const to = shown.findIndex((image) => image.id === target);
    if (from < 0 || to < 0) return;
    move(from, to - from);
  }

  async function remove() {
    if (!removing) return;
    const done = await action.run(
      () =>
        api.DELETE("/v1/staff/maps/{map}/images/{id}", {
          params: { path: { map, id: removing.id } },
        }),
      "The picture couldn't be removed. Try again.",
    );
    if (done) setRemoving(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-text-muted text-sm tabular-nums">
          {images.length} of {MAX_IMAGES}
          {images.length > 1 && " · drag to reorder"}
        </span>
        {unsaved && (
          <span className="motion-enter ml-auto flex items-center gap-2">
            <span className="text-text-muted text-sm">Order not saved</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                action.clearError();
              }}
              disabled={action.busy}
            >
              Reset
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={saveOrder}
              disabled={action.busy}
            >
              {action.busy ? "Saving…" : "Save order"}
            </Button>
          </span>
        )}
        <Button
          size="sm"
          onClick={() => input.current?.click()}
          disabled={room === 0 || uploading !== null}
        >
          <ImageUp aria-hidden />
          {uploading ?? "Add images"}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={TYPES.join(",")}
          onChange={add}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose images"
        />
      </div>
      {problems.length > 0 && (
        <ul className="text-danger flex flex-col gap-0.5 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {action.error && !removing && (
        <p className="text-danger text-sm">{action.error}</p>
      )}
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((image, index) => (
            <li
              key={image.id}
              ref={slide.tile(image.id)}
              className="motion-enter flex flex-col gap-1.5"
            >
              <div
                onPointerDown={(event) => startDrag(event, image.id)}
                onPointerMove={drag}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
                className={`relative touch-none overflow-hidden rounded-md border transition select-none ${
                  dragging === image.id
                    ? "border-accent ring-accent cursor-grabbing opacity-80 ring-2"
                    : "border-border cursor-grab"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbnail_url}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="aspect-video w-full object-cover"
                />
                {index === 0 && (
                  <Badge tone="accent" className="absolute top-1.5 left-1.5">
                    Cover
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="flex">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move earlier"
                    disabled={index === 0 || action.busy}
                    onClick={() => move(index, -1)}
                    className="px-1.5"
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move later"
                    disabled={index === shown.length - 1 || action.busy}
                    onClick={() => move(index, 1)}
                    className="px-1.5"
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </span>
                <span className="flex">
                  {index > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Make cover"
                      title="Make cover"
                      disabled={action.busy}
                      onClick={() => move(index, -index)}
                      className="px-1.5"
                    >
                      <Star aria-hidden />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove"
                    title="Remove"
                    onClick={() => setRemoving(image)}
                    className="px-1.5"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
          action.clearError();
        }}
        title="Remove this picture?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={remove} disabled={action.busy}>
              {action.busy ? "Removing…" : "Remove"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {removing && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={removing.thumbnail_url}
              alt=""
              className="border-border aspect-video w-full rounded-md border object-cover"
            />
          )}
          <p className="text-text-muted text-sm">
            {removing === images[0]
              ? "It's the cover; the next picture becomes the cover."
              : "It leaves the map's pictures for good."}
          </p>
          {action.error && (
            <p className="text-danger text-sm">{action.error}</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
