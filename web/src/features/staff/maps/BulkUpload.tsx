"use client";
// The Maps page's "Map files" tab, for staff: viewer files for many maps at once. Staff drop the folder
// `sj-pack` packed (or its `packed` folder), or a folder of maps that the page packs itself, one per worker.
// Maps that already have a file are left alone unless staff choose to replace them; a map packed here whose
// stripped copy matches the stored one is skipped either way. Below, the maps with runs that still need a file.
import { FolderUp, Play, Square } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { api, failureMessage } from "@/api/client";
import type { components } from "@/api/schema";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import {
  droppedFiles,
  type MapFile,
  type Refused,
  sortFiles,
} from "./bulkUpload";
import { MissingViewerFiles } from "./MissingViewerFiles";
import { uploadViewerFile } from "./uploadViewerFile";
import { packMap } from "./viewerPack";

type Status =
  | { step: "ready" }
  | { step: "packing"; fraction: number }
  | { step: "uploading"; fraction: number }
  | { step: "stored"; bytes: number }
  | { step: "same" }
  | { step: "failed"; reason: string };

type Row = MapFile & { status: Status };

/** What SourceJump holds for a map: the stripped map's hash, and the packed size. */
type Stored = { hash: string; bytes: number };

/**
 * Maps worked on at once. Each packing worker holds a whole map and its packed copy, up to a few GB for the
 * largest, so it stays below the core count; packed files only upload, two or more at a time.
 */
const LANES = Math.min(
  4,
  Math.max(
    2,
    Math.floor(
      (typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency) /
        2,
    ),
  ),
);

export function BulkUpload() {
  const [stored, setStored] = useState<Map<string, Stored> | null>(null);
  const [missing, setMissing] = useState<
    components["schemas"]["MissingViewerFile"][] | null
  >(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [replace, setReplace] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stop = useRef<AbortController | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .GET("/v1/staff/viewer-files")
      .then(({ data, error }) => {
        if (!data) {
          setLoadFailure(
            failureMessage(error, "Stored files couldn't be loaded."),
          );
          return;
        }
        setMissing(data.missing);
        setStored(
          new Map(
            data.files.map((file) => [
              file.map,
              { hash: file.hash, bytes: file.bytes },
            ]),
          ),
        );
      })
      .catch(() => setLoadFailure("Stored files couldn't be loaded."));
  }, []);

  // Leaving the page stops packing and uploading, so ask first.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function take(files: File[]) {
    if (running) return;
    const sorted = sortFiles(files);
    setRows(sorted.maps.map((map) => ({ ...map, status: { step: "ready" } })));
    setRefused(sorted.refused);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void droppedFiles(event.dataTransfer.items).then(take);
  }

  const setStatus = (map: string, status: Status) =>
    setRows((rows) =>
      rows.map((row) => (row.map === map ? { ...row, status } : row)),
    );

  const included = (row: Row) =>
    (row.status.step === "ready" || row.status.step === "failed") &&
    (replace || !stored?.has(row.map));
  const queued = rows.filter(included);

  async function start() {
    const controller = new AbortController();
    stop.current = controller;
    setRunning(true);
    const queue = [...queued];
    const lane = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        if (controller.signal.aborted) return;
        await work(row, controller.signal);
      }
    };
    await Promise.all(Array.from({ length: LANES }, lane));
    setRunning(false);
  }

  async function work(row: Row, signal: AbortSignal) {
    let body: Blob | ArrayBuffer = row.file;
    let hash = "";
    if (!row.packed) {
      setStatus(row.map, { step: "packing", fraction: 0 });
      try {
        const packed = await packMap(
          row.file,
          (fraction) => setStatus(row.map, { step: "packing", fraction }),
          signal,
        );
        if (stored?.get(row.map)?.hash === packed.hash) {
          setStatus(row.map, { step: "same" });
          return;
        }
        body = packed.file;
        hash = packed.hash;
      } catch (error) {
        setStatus(
          row.map,
          signal.aborted
            ? { step: "ready" }
            : { step: "failed", reason: (error as Error).message },
        );
        return;
      }
    }
    setStatus(row.map, { step: "uploading", fraction: 0 });
    const result = await uploadViewerFile(row.map, body, (fraction) =>
      setStatus(row.map, { step: "uploading", fraction }),
    );
    if (!result.ok) {
      setStatus(row.map, { step: "failed", reason: result.message });
      return;
    }
    const bytes = body instanceof Blob ? body.size : body.byteLength;
    setStatus(row.map, { step: "stored", bytes });
    // A file sj-pack packed carries no hash here; any stored file counts as there for the next drop.
    setStored((stored) => new Map(stored).set(row.map, { hash, bytes }));
  }

  const count = (step: Status["step"]) =>
    rows.filter((row) => row.status.step === step).length;
  const alreadyStored = rows.filter(
    (row) => row.status.step === "ready" && stored?.has(row.map),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!running) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={classNames(
          "flex min-h-36 flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center text-sm transition-colors duration-(--duration-fast)",
          dragging ? "border-accent bg-accent-soft" : "border-border-strong",
        )}
      >
        <span className="text-text-muted max-w-xl">
          Drop the folder sj-pack packed, or its <code>packed</code> folder. A
          folder of <code>.bsp</code> or <code>.bsp.bz2</code> maps works too:
          this page packs them first, which is slower than sj-pack and needs the
          tab kept open.
        </span>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            disabled={running}
            onClick={() => folderInput.current?.click()}
          >
            <FolderUp aria-hidden />
            Choose a folder
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={running}
            onClick={() => filesInput.current?.click()}
          >
            Choose files
          </Button>
        </div>
        <input
          ref={folderInput}
          type="file"
          // A folder, with everything in it; React passes the attribute through as written.
          {...{ webkitdirectory: "" }}
          onChange={(event) => {
            take([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a folder of maps"
        />
        <input
          ref={filesInput}
          type="file"
          multiple
          accept=".br,.bsp,.bz2"
          onChange={(event) => {
            take([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose map files"
        />
      </div>

      {loadFailure && <p className="text-danger text-sm">{loadFailure}</p>}

      {rows.length > 0 && (
        <Card className="motion-enter flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-text-muted text-sm tabular-nums">
            {rows.length} {rows.length === 1 ? "map" : "maps"} ·{" "}
            {count("stored")} stored now
            {count("same") > 0 && ` · ${count("same")} unchanged`}
            {count("failed") > 0 && ` · ${count("failed")} failed`}
            {alreadyStored > 0 && ` · ${alreadyStored} already have a file`}
          </span>
          <span className="flex flex-wrap items-center gap-3">
            {alreadyStored > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={replace}
                  disabled={running}
                  onChange={(event) => setReplace(event.target.checked)}
                  className="accent-accent size-4"
                />
                Replace their files
              </label>
            )}
            {running ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => stop.current?.abort()}
              >
                <Square aria-hidden />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={queued.length === 0 || stored === null}
                onClick={() => void start()}
              >
                <Play aria-hidden />
                Upload {queued.length} {queued.length === 1 ? "map" : "maps"}
              </Button>
            )}
          </span>
        </Card>
      )}

      {refused.length > 0 && (
        <ul className="text-text-muted flex flex-col gap-1 text-sm">
          {refused.map(({ file, reason }) => (
            <li key={file}>
              Skipping {file}: {reason}.
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Map</TableHeaderCell>
              <TableHeaderCell>From</TableHeaderCell>
              <TableHeaderCell className="w-1/2">Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.map}>
                <TableCell className="font-bold">{row.map}</TableCell>
                <TableCell className="text-text-muted">
                  {row.packed ? "Packed by sj-pack" : "Packed here"} ·{" "}
                  <span className="tabular-nums">
                    {megabytes(row.file.size)}
                  </span>
                </TableCell>
                <TableCell>
                  <RowStatus
                    status={row.status}
                    stored={stored?.get(row.map)}
                    replace={replace}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {missing && stored && (
        <MissingViewerFiles
          maps={missing.filter((map) => !stored.has(map.map))}
        />
      )}
    </div>
  );
}

function RowStatus({
  status,
  stored,
  replace,
}: {
  status: Status;
  stored: Stored | undefined;
  replace: boolean;
}) {
  switch (status.step) {
    case "ready":
      return stored ? (
        replace ? (
          <Badge tone="warning">Replaces the stored file</Badge>
        ) : (
          <span className="text-text-muted text-sm">
            Has a file already, {megabytes(stored.bytes)}
          </span>
        )
      ) : (
        <Badge>New</Badge>
      );
    case "packing":
    case "uploading":
      return (
        <div className="flex items-center gap-3">
          <span className="text-text-muted w-36 shrink-0 text-sm tabular-nums">
            {status.step === "packing"
              ? `Packing ${Math.floor(status.fraction * 100)}%`
              : status.fraction < 1
                ? `Uploading ${Math.floor(status.fraction * 100)}%`
                : // Sent; SourceJump unpacks and checks it, up to ten seconds or so for the largest maps.
                  "Checking…"}
          </span>
          <div
            role="progressbar"
            aria-label={status.step === "packing" ? "Packing" : "Uploading"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(status.fraction * 100)}
            className="bg-surface-raised h-1.5 flex-1 overflow-hidden rounded-full"
          >
            <div
              className="bg-accent h-full origin-left rounded-full transition-transform duration-(--duration-fast)"
              style={{ transform: `scaleX(${status.fraction})` }}
            />
          </div>
        </div>
      );
    case "stored":
      return (
        <Badge tone="success" className="motion-enter">
          Stored, {megabytes(status.bytes)}
        </Badge>
      );
    case "same":
      return (
        <span className="text-text-muted text-sm">Same as the stored file</span>
      );
    case "failed":
      return <span className="text-danger text-sm">{status.reason}</span>;
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
