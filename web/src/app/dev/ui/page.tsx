// Style guide (development only): every token and primitive on one page, for review and screenshot tests.
import { Globe, Map, Timer, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LegacyBadge } from "@/features/legacy/LegacyBadge";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Button, ButtonLink } from "@/ui/Button";
import { Card, Label } from "@/ui/Card";
import { DividedList, DividedSection } from "@/ui/Divided";
import { Flag } from "@/ui/Flag";
import { Input } from "@/ui/Input";
import { LinkTabs } from "@/ui/LinkTabs";
import { Medal } from "@/ui/Medal";
import { Menu, MenuItem, MenuSeparator } from "@/ui/Menu";
import { Page } from "@/ui/Page";
import { Pager } from "@/ui/Pager";
import { Prose } from "@/ui/Prose";
import { StatCard } from "@/ui/StatCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { Tabs } from "@/ui/Tabs";
import { Textarea } from "@/ui/Textarea";
import { TierBadge } from "@/ui/TierBadge";
import { Tooltip } from "@/ui/Tooltip";
import { DialogDemo } from "./DialogDemo";
import { LineChartDemo } from "./LineChartDemo";
import { MotionDemo } from "./MotionDemo";
import { ChoiceMenuDemo } from "./ChoiceMenuDemo";
import { SegmentedDemo } from "./SegmentedDemo";
import { StepChartDemo } from "./StepChartDemo";

export const metadata: Metadata = {
  title: "Style guide",
  robots: { index: false },
};

// Class names are spelled out in full so Tailwind can find them in the source.
const colors = [
  ["bg", "bg-bg"],
  ["surface", "bg-surface"],
  ["surface-raised", "bg-surface-raised"],
  ["surface-overlay", "bg-surface-overlay"],
  ["border", "bg-border"],
  ["border-strong", "bg-border-strong"],
  ["text", "bg-text"],
  ["text-muted", "bg-text-muted"],
  ["text-subtle", "bg-text-subtle"],
  ["accent", "bg-accent"],
  ["accent-hover", "bg-accent-hover"],
  ["accent-soft", "bg-accent-soft"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["gold", "bg-gold"],
  ["silver", "bg-silver"],
  ["bronze", "bg-bronze"],
  ["tier-1", "bg-tier-1"],
  ["tier-2", "bg-tier-2"],
  ["tier-3", "bg-tier-3"],
  ["tier-4", "bg-tier-4"],
] as const;

const typeScale = [
  ["4xl", "text-4xl font-bold"],
  ["3xl", "text-3xl font-bold"],
  ["2xl", "text-2xl font-bold"],
  ["xl", "text-xl font-bold"],
  ["lg", "text-lg"],
  ["base", "text-base"],
  ["sm", "text-sm"],
  ["xs", "text-xs"],
] as const;

// Sample data: invented players on real map names.
const leaderboard = [
  {
    name: "nova",
    time: "01:24.405",
    style: "Normal",
    diff: "WR",
    date: "Oct 12",
  },
  {
    name: "ricochet",
    time: "01:24.645",
    style: "Normal",
    diff: "+0.240",
    date: "Oct 9",
  },
  {
    name: "strafe_cat",
    time: "01:25.125",
    style: "Normal",
    diff: "+0.720",
    date: "Sep 30",
  },
  {
    name: "lowgrav",
    time: "01:26.010",
    style: "Normal",
    diff: "+1.605",
    date: "Sep 28",
  },
  {
    name: "Ørjan",
    time: "01:31.977",
    style: "Normal",
    diff: "+7.572",
    date: "Aug 2",
  },
];

export default function StyleGuidePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <Page className="gap-14">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Style guide</h1>
        <p className="text-text-muted">
          Every design token and primitive in <code>src/ui/</code>. Pages are
          built only from these. Development builds only.
        </p>
      </header>

      <Section title="Colors">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {colors.map(([name, className]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div
                className={`border-border h-14 rounded-md border ${className}`}
              />
              <code className="text-text-muted text-xs">{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <p className="text-text-muted text-sm">
          Play for everything. Its digits share one width, so times line up:
        </p>
        <div className="flex flex-col gap-2">
          {typeScale.map(([name, className]) => (
            <div key={name} className="flex items-baseline gap-6">
              <code className="text-text-subtle w-12 shrink-0 text-xs">
                {name}
              </code>
              <span className={className}>bhop_forest 01:24.405</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius and elevation">
        <div className="flex flex-wrap gap-4">
          <Swatch
            label="radius-sm · badges, rows inside a frame"
            className="rounded-sm"
          />
          <Swatch
            label="radius-md · every frame: panels, fields, buttons, menus"
            className="rounded-md"
          />
          <Swatch
            label="shadow-popover"
            className="shadow-popover rounded-md"
          />
          <Swatch label="shadow-dialog" className="shadow-dialog rounded-md" />
          <Swatch label="shadow-glow" className="shadow-glow rounded-md" />
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">View records</Button>
          <Button>Browse maps</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary" size="sm">
            Small primary
          </Button>
          <Button size="sm">
            <Timer aria-hidden />
            With icon
          </Button>
          <ButtonLink href="/ruleset" variant="ghost" size="sm">
            Link styled as a button
          </ButtonLink>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Badges, flags, medals and tiers">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="accent">WR</Badge>
          <Badge>Normal</Badge>
          <Badge tone="success">Online</Badge>
          <Badge tone="warning">Outdated plugin</Badge>
          <Badge tone="danger">Key revoked</Badge>
          <LegacyBadge />
        </div>
        <div className="flex items-center gap-3">
          {["NO", "US", "DE", "BR", "KR", null].map((code) => (
            <Flag key={code ?? "none"} code={code} />
          ))}
          <span className="text-text-muted text-sm">
            The last is the placeholder for no country on Steam.
          </span>
        </div>
        <div className="flex items-center gap-3">
          {[1, 2, 3, 4, 12].map((placement) => (
            <Medal key={placement} placement={placement} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-text-muted text-sm">
            Tier colors follow each tier&apos;s position on the ramp, so they
            work for any tier count staff set. Shown with 10 and with 6:
          </p>
          {[10, 6].map((count) => (
            <div key={count} className="flex flex-wrap gap-2">
              {Array.from({ length: count }, (_, index) => (
                <TierBadge key={index} tier={index + 1} tierCount={count} />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Stat cards">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="World records"
            value={24892}
            icon={Globe}
            detail="12 today"
          />
          <StatCard label="Active players" value={8412} icon={Users} />
          <StatCard label="Maps" value={3105} icon={Map} />
          <StatCard
            label="Completed runs"
            value={14_800_000}
            format={{ notation: "compact", maximumFractionDigits: 1 }}
            icon={Timer}
          />
        </div>
      </Section>

      <Section title="Table">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell className="w-16">Rank</TableHeaderCell>
              <TableHeaderCell>Player</TableHeaderCell>
              <TableHeaderCell>Map</TableHeaderCell>
              <TableHeaderCell numeric>Time</TableHeaderCell>
              <TableHeaderCell>Style</TableHeaderCell>
              <TableHeaderCell numeric>Diff</TableHeaderCell>
              <TableHeaderCell numeric>Date</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {leaderboard.map((run, index) => (
              <TableRow key={run.name} highlight={index === 0}>
                <TableCell>
                  <Medal placement={index + 1} />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Avatar name={run.name} size="sm" />
                    {run.name}
                  </span>
                </TableCell>
                <TableCell className="text-text-muted">bhop_forest</TableCell>
                <TableCell numeric>{run.time}</TableCell>
                <TableCell className="text-text-muted">{run.style}</TableCell>
                <TableCell numeric>
                  {run.diff === "WR" ? (
                    <Badge tone="accent">WR</Badge>
                  ) : (
                    <span className="text-text-muted">{run.diff}</span>
                  )}
                </TableCell>
                <TableCell numeric className="text-text-muted">
                  {run.date}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Tabs">
        <div className="grid gap-8 lg:grid-cols-2">
          <Tabs
            label="Styles"
            tabs={[
              {
                id: "normal",
                label: "Normal",
                content: <Panel>Normal records</Panel>,
              },
              {
                id: "sideways",
                label: "Sideways",
                content: <Panel>Sideways records</Panel>,
              },
              {
                id: "w-only",
                label: "W-only",
                content: <Panel>W-only records</Panel>,
              },
            ]}
          />
          <Tabs
            label="Sort maps"
            variant="segmented"
            tabs={[
              {
                id: "tier",
                label: "Tier",
                content: <Panel>Sorted by tier</Panel>,
              },
              {
                id: "popular",
                label: "Popular",
                content: <Panel>Sorted by completions</Panel>,
              },
              {
                id: "newest",
                label: "Newest",
                content: <Panel>Sorted by date added</Panel>,
              },
            ]}
          />
        </div>
        <p className="text-text-muted text-sm">
          LinkTabs look the same but are links, for views the server renders,
          such as the Maps page&apos;s sort:
        </p>
        <LinkTabs
          label="Example styles"
          className="self-start"
          tabs={["Normal", "Sideways", "W-only"].map((name, index) => ({
            href: index === 0 ? "/dev/ui" : `/dev/ui?style=${index}`,
            label: name,
            current: index === 0,
          }))}
        />
        <p className="text-text-muted text-sm">
          Segmented looks the same and changes the view in place, like a
          server&apos;s activity range:
        </p>
        <SegmentedDemo />
        <p className="text-text-muted text-sm">
          ChoiceMenu picks one option from a list, like a board&apos;s style and
          track:
        </p>
        <ChoiceMenuDemo />
        <Pager page={2} pageCount={5} href={() => "/dev/ui"} />
      </Section>

      <Section title="Step chart">
        <Card>
          <StepChartDemo />
        </Card>
      </Section>

      <Section title="Divided list">
        <Card className="flex max-w-xl flex-col gap-3 py-2">
          <DividedList>
            {[
              "kite rated bhop_arcane main tier 3",
              "nova listed server 203.0.113.9:27015",
              "ricochet published zones for bhop_badges",
            ].map((line) => (
              <li key={line} className="py-3">
                {line}
              </li>
            ))}
          </DividedList>
          <DividedSection className="flex justify-end pb-2">
            <Button size="sm" variant="ghost">
              Action
            </Button>
          </DividedSection>
        </Card>
      </Section>

      <Section title="Line chart">
        <Card>
          <LineChartDemo />
        </Card>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip content="12 October 2026, 21:04 UTC">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
          <Menu
            trigger="Account"
            triggerClassName="h-10 rounded-md border border-border bg-surface px-4 text-sm font-bold hover:bg-surface-raised"
          >
            <MenuItem>Profile</MenuItem>
            <MenuItem>Settings</MenuItem>
            <MenuSeparator />
            <MenuItem>Sign out</MenuItem>
          </Menu>
          <DialogDemo />
        </div>
      </Section>

      <Section title="Inputs and avatars">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Input placeholder="bhop_forest" aria-label="Map name" />
            <Textarea
              placeholder="A post's text, in Markdown"
              aria-label="Post text"
              rows={3}
            />
          </div>
          <div className="flex items-center gap-3">
            <Avatar name="nova" size="sm" />
            <Avatar name="ricochet" size="md" />
            <Avatar name="strafe cat" size="lg" />
            <Avatar name="Ørjan" size="xl" />
          </div>
        </div>
      </Section>

      <Section title="Prose">
        <Card>
          {/* Fixed sample HTML, as the API renders a post's Markdown. */}
          <Prose
            html={`<h2>A heading</h2><p>Paragraphs with <em>emphasis</em>, <strong>bold</strong>, <del>struck</del> text, <code>code</code> and <a href="/maps">a link</a>.</p><blockquote><p>A quote.</p></blockquote><ul><li>A list</li><li>With two items</li></ul>`}
          />
        </Card>
      </Section>

      <Section title="Motion">
        <p className="text-text-muted text-sm">
          With reduced motion turned on, each one shows its end state at once.
        </p>
        <MotionDemo />
      </Section>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-border border-b pb-2 text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ label, className }: { label: string; className: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`border-border-strong bg-surface size-24 border ${className}`}
      />
      <Label>{label}</Label>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <Card className="text-text-muted text-sm">{children}</Card>;
}
