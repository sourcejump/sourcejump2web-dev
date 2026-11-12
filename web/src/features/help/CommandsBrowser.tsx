"use client";
// The Commands page's list: search, a players/admins filter and the sections beside it on wide screens, then each
// plugin's commands, as a table on wide screens and as rows in a card on a phone, where the columns won't fit.
import { Search } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Card } from "@/ui/Card";
import { DividedList } from "@/ui/Divided";
import { Input } from "@/ui/Input";
import { Segmented } from "@/ui/Segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import {
  adminFlags,
  type Command,
  type CommandGroup,
  commandGroups,
  commandMatches,
  defaultStyleCommands,
  isAdminCommand,
  type StyleCommands,
  styleMatches,
  type Text,
} from "./commands";

type Audience = "all" | "players" | "admins";

const audiences = [
  { value: "all", label: "All" },
  { value: "players", label: "Players" },
  { value: "admins", label: "Admins" },
] satisfies { value: Audience; label: string }[];

/** The table on screens wide enough for its columns; the card below that. */
const wideOnly = "hidden md:block";
const narrowOnly = "md:hidden";

export function CommandsBrowser() {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<Audience>("all");

  const groups = commandGroups
    .map((group) => ({
      ...group,
      commands: group.commands.filter(
        (command) =>
          commandMatches(command, query) &&
          (audience === "all" ||
            isAdminCommand(command) === (audience === "admins")),
      ),
    }))
    .filter((group) => group.commands.length > 0);
  // Every style command is a player's.
  const styles =
    audience === "admins"
      ? []
      : defaultStyleCommands.filter((style) => styleMatches(style, query));

  const sections = [
    ...groups.map(({ id, title, commands }) => ({
      id,
      title,
      count: commands.length,
    })),
    ...(styles.length > 0
      ? [{ id: "styles", title: "Styles", count: styles.length }]
      : []),
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-4">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <Input
          icon={Search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands"
          aria-label="Search commands and aliases"
        />
        <Segmented
          label="Who the commands are for"
          options={audiences}
          value={audience}
          onChange={(value) => setAudience(value as Audience)}
          fillOnPhones
          className="lg:flex"
        />
        <nav aria-label="Sections">
          {/* A column with counts beside the commands; on a phone, a few rows of names above them. */}
          <ul className="text-text-muted flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col lg:gap-0">
            {sections.map(({ id, title, count }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="hover:text-accent flex justify-between gap-4 lg:py-1"
                >
                  <span>{title}</span>
                  <span className="text-text-subtle hidden tabular-nums lg:inline">
                    {count}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col gap-10 lg:col-span-3">
        {groups.map((group) => (
          <GroupSection key={group.id} group={group} />
        ))}
        {styles.length > 0 && <StylesSection styles={styles} />}
        {sections.length === 0 && (
          <p className="text-text-muted" role="status">
            No command or alias
            {audience === "all" ? "" : ` for ${audience}`} contains “
            {query.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}

function GroupSection({ group }: { group: CommandGroup }) {
  return (
    <Section
      id={group.id}
      title={group.title}
      plugins={group.plugins}
      intro={group.intro}
      notes={group.notes}
    >
      <CommandTable
        label={`${group.id}-title`}
        headings={["Command", "Also", "What it does"]}
      >
        {group.commands.map((command) => (
          <TableRow key={command.name}>
            <TableCell wrap className="py-3 align-top">
              <CommandHead command={command} />
            </TableCell>
            <TableCell wrap className="py-3 align-top">
              <OtherNames command={command} />
            </TableCell>
            <TableCell wrap className="py-3 align-top">
              <RichText text={command.description} />
            </TableCell>
          </TableRow>
        ))}
      </CommandTable>
      <Card className={narrowOnly}>
        <DividedList className="-my-2">
          {group.commands.map((command) => (
            <li key={command.name} className="flex flex-col gap-1 py-3">
              <CommandHead command={command} />
              <OtherNames command={command} labelled />
              <p className="text-sm">
                <RichText text={command.description} />
              </p>
            </li>
          ))}
        </DividedList>
      </Card>
    </Section>
  );
}

function StylesSection({ styles }: { styles: readonly StyleCommands[] }) {
  return (
    <Section
      id="styles"
      title="Styles"
      plugins={["shavit-styles.cfg"]}
      intro={[
        "Each style a server sets up adds commands to switch to it, and leaderboard commands such as ",
        { code: "!wrsw" },
        " (see Records). These are shavit's defaults; a server's styles and their commands can differ.",
      ]}
      notes={[
        [
          "Segmented's ",
          { code: "!sr" },
          " has the same name as the Records command ",
          { code: "!sr" },
          " (server record), so both are registered under one name.",
        ],
      ]}
    >
      <CommandTable label="styles-title" headings={["Style", "Commands"]}>
        {styles.map(({ style, commands }) => (
          <TableRow key={style}>
            <TableCell className="py-3">{style}</TableCell>
            <TableCell wrap className="py-3">
              <Names names={commands} first />
            </TableCell>
          </TableRow>
        ))}
      </CommandTable>
      <Card className={narrowOnly}>
        <DividedList className="-my-2">
          {styles.map(({ style, commands }) => (
            <li key={style} className="flex flex-col gap-1 py-3">
              <span>{style}</span>
              <span className="text-sm">
                <Names names={commands} first />
              </span>
            </li>
          ))}
        </DividedList>
      </Card>
    </Section>
  );
}

/**
 * Every section's table has the same fixed columns, so the columns line up from one plugin to the next instead
 * of each table sizing them to its own longest name.
 */
function CommandTable({
  label,
  headings,
  children,
}: {
  label: string;
  headings: string[];
  children: ReactNode;
}) {
  return (
    <Table
      aria-labelledby={label}
      className={`${wideOnly} [&_table]:table-fixed`}
    >
      <colgroup>
        <col className="w-56" />
        {headings.length > 2 && <col className="w-56" />}
        <col />
      </colgroup>
      <TableHead>
        <TableRow>
          {headings.map((heading) => (
            <TableHeaderCell key={heading}>{heading}</TableHeaderCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function Section({
  id,
  title,
  plugins,
  intro,
  notes,
  children,
}: {
  id: string;
  title: string;
  plugins: readonly string[];
  intro?: Text;
  notes?: readonly Text[];
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-20 flex-col gap-3"
    >
      <h2 id={`${id}-title`} className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-xl font-bold">{title}</span>
        <span className="text-text-subtle text-sm">{plugins.join(", ")}</span>
      </h2>
      {intro && (
        <p className="text-text-muted text-sm">
          <RichText text={intro} />
        </p>
      )}
      {children}
      {notes?.map((note, index) => (
        <p key={index} className="text-text-muted text-sm">
          <RichText text={note} />
        </p>
      ))}
    </section>
  );
}

/** The command's name and arguments, and, for one only some may use, who. */
function CommandHead({ command }: { command: Command }) {
  const { who } = command;
  return (
    <div className="flex flex-col gap-0.5">
      <span>
        <Name name={command.name} first />
        {command.args && (
          <span className="text-text-muted text-sm"> {command.args}</span>
        )}
      </span>
      {typeof who === "object" && (
        <span className="text-warning text-xs">
          Admin, flag {who.flag} ({adminFlags[who.flag]})
        </span>
      )}
      {who === "granted" && (
        <span className="text-text-muted text-xs">
          Players an admin gave access
        </span>
      )}
    </div>
  );
}

/** Aliases, and binds for TAS. `labelled` names the aliases where no column heading does (a phone's card). */
function OtherNames({
  command,
  labelled = false,
}: {
  command: Command;
  labelled?: boolean;
}) {
  if (!command.aliases && !command.binds) return null;
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      {command.aliases && (
        <span>
          {labelled && <span className="text-text-subtle">Also </span>}
          <Names names={command.aliases} />
        </span>
      )}
      {command.binds && (
        <span>
          <span className="text-text-subtle">Bind </span>
          <Names names={command.binds} />
        </span>
      )}
    </div>
  );
}

/** Names separated by commas. The line may break after a comma, never inside a name. */
function Names({
  names,
  first = false,
}: {
  names: readonly string[];
  first?: boolean;
}) {
  return names.map((name, index) => (
    <Fragment key={name}>
      <Name name={name} first={first && index === 0} />
      {index < names.length - 1 && ", "}
    </Fragment>
  ));
}

/**
 * A command's name. `first` marks the one to look for, in the accent; aliases are muted. A `<style>` in a name
 * is a placeholder typed with no space before it (`!wr<style>` is `!wrsw`), so it shows as part of the word.
 */
function Name({ name, first = false }: { name: string; first?: boolean }) {
  const parts = name.split(/(<[^>]+>)/).filter((part) => part !== "");
  return (
    <code
      className={
        first
          ? "text-accent font-bold whitespace-nowrap"
          : "text-text-muted whitespace-nowrap"
      }
    >
      {parts.map((part, index) =>
        part.startsWith("<") ? (
          <i key={index} className="text-text-subtle font-normal">
            {part.slice(1, -1)}
          </i>
        ) : (
          part
        ),
      )}
    </code>
  );
}

function RichText({ text }: { text: Text }) {
  if (typeof text === "string") return text;
  return text.map((part, index) =>
    typeof part === "string" ? part : <Code key={index}>{part.code}</Code>,
  );
}

/** Code inside a sentence, set apart from the words around it. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-surface-raised rounded-sm px-1 text-sm whitespace-nowrap">
      {children}
    </code>
  );
}
