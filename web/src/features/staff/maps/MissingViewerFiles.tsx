"use client";
// The "Map files" tab's list of maps that have runs but no viewer file, so their replays can't be watched yet:
// the files staff should look for first. Maps leave it as their files are uploaded above.
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { components } from "@/api/schema";
import { Button } from "@/ui/Button";
import { Link } from "@/ui/Link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";

type Missing = components["schemas"]["MissingViewerFile"];

/** Shown before "Show all": enough to work through, without rendering thousands of rows at once. */
const FIRST = 50;

export function MissingViewerFiles({ maps }: { maps: Missing[] }) {
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const shown = all ? maps : maps.slice(0, FIRST);
  const waiting = maps.reduce((sum, map) => sum + map.replays, 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        maps.map((map) => map.map).join("\n"),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Without clipboard access the names are still in the table to select.
    }
  }

  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="missing-viewer-files"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="missing-viewer-files" className="text-xl font-bold">
            Maps without a file
          </h2>
          <p className="text-text-muted text-sm">
            {maps.length === 0
              ? "Every map with runs has a file."
              : `${maps.length} ${maps.length === 1 ? "map has" : "maps have"} runs but no file, with ${waiting} ${waiting === 1 ? "replay" : "replays"} waiting on one. Most replays first.`}
          </p>
        </div>
        {maps.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void copy()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy names"}
          </Button>
        )}
      </div>
      {maps.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Map</TableHeaderCell>
              <TableHeaderCell numeric>Replays</TableHeaderCell>
              <TableHeaderCell numeric>Runs</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((map) => (
              <TableRow key={map.map}>
                <TableCell className="font-bold">
                  <Link href={`/maps/${map.map}`} className="hover:text-accent">
                    {map.map}
                  </Link>
                </TableCell>
                <TableCell numeric>{map.replays}</TableCell>
                <TableCell numeric className="text-text-muted">
                  {map.runs}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {maps.length > shown.length && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => setAll(true)}
        >
          Show all {maps.length}
        </Button>
      )}
    </section>
  );
}
