// The Maps page's "No runs yet" tab, for staff who hold manage_maps or manage_zones: maps SourceJump knows
// that nobody has finished a run on, usually zoned ahead of their first run, each opening its Manage view.
import { api } from "@/api/client";
import { Card } from "@/ui/Card";
import { Link } from "@/ui/Link";
import { Pager } from "@/ui/Pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { ReadFailure } from "../ReadFailure";
import { readAsStaff } from "../staffApi";

const PAGE_SIZE = 50;

export async function UnplayedMaps({
  q,
  page,
  href,
}: {
  q: string;
  page: number;
  href: (page: number) => string;
}) {
  const result = await readAsStaff((headers) =>
    api.GET("/v1/staff/maps", {
      params: {
        query: { q, no_runs: true, offset: (page - 1) * PAGE_SIZE },
      },
      headers,
    }),
  );
  if (!("data" in result)) return <ReadFailure failure={result} />;
  const { maps, total } = result.data;
  if (maps.length === 0) {
    return (
      <Card className="text-text-muted">
        {q
          ? "No map without runs has that name."
          : "Every map SourceJump knows has a finished run."}
      </Card>
    );
  }
  return (
    <>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Map</TableHeaderCell>
            <TableHeaderCell>Zones</TableHeaderCell>
            <TableHeaderCell>Tier</TableHeaderCell>
            <TableHeaderCell>Image</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {maps.map((map) => (
            <TableRow key={map.name}>
              <TableCell>
                <Link
                  href={`/maps/${map.name}/manage`}
                  className="hover:text-accent font-bold"
                >
                  {map.name}
                </Link>
              </TableCell>
              <TableCell
                className={map.zone_version ? undefined : "text-warning"}
              >
                {map.zone_version ? `Version ${map.zone_version}` : "None"}
              </TableCell>
              <TableCell className="text-text-muted tabular-nums">
                {map.tier ?? "–"}
              </TableCell>
              <TableCell className="text-text-muted">
                {map.image ? "Set" : "–"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        total={total}
        noun={total === 1 ? "map" : "maps"}
        href={href}
      />
    </>
  );
}
