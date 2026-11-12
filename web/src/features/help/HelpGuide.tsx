// The help page's guide: what bhop and SourceJump are and how to play, its sections in reading order, with a list of them at the top to jump to.
import { ArrowUpRight, CirclePlay } from "lucide-react";
import type { ReactNode } from "react";
import { classNames } from "@/ui/classNames";
import { Card } from "@/ui/Card";
import { Link } from "@/ui/Link";

/** Linguistie's beginner series on auto-bhop. Made for CS:GO, but the movement is the same in CS:S. */
const beginnerPlaylist =
  "https://www.youtube.com/playlist?list=PLRpPuTzNftfjj4cIeyQ8JkSn855XZN56R";
const discord = "https://discord.gg/RYP5G4tuwX";
/** The SourceJump plugin servers install to connect. */
const pluginRepo = "https://github.com/sourcejump/plugins";

/**
 * The commands a new player needs, from the timer every connected server runs (shavit's bhoptimer, with
 * SourceJump's plugin). Each server can also add its own.
 */
const commands: [string, ReactNode][] = [
  ["!r", "Back to the start zone, with a fresh timer."],
  ["!b", "To the bonus start zone, if the map has a bonus."],
  ["!style", "Choose your style."],
  ["!stop", "Stop your timer."],
  [
    "!wr",
    "The map's leaderboard. On a style SourceJump ranks, it shows SourceJump's.",
  ],
  ["!pb", "Your best time on the map."],
  [
    "!replay",
    "Watch the replay bot: the fastest run, played back. A good way to learn a route.",
  ],
  ["!nc", "Noclip: fly through the map to look around. Stops your timer."],
  [
    "!cp",
    "Checkpoints: save a spot and teleport back to it to practise a part. A run that uses them doesn't count.",
  ],
  ["!hide", "Hide other players."],
  ["!hud", "Choose what the on-screen display shows."],
  [
    "!wrdisplay",
    "Choose which styles' SourceJump record announcements you see.",
  ],
  ["!discord", "The link to SourceJump's Discord."],
];

const sections: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "what-is-bhop",
    title: "What bunnyhopping is",
    body: (
      <>
        <p>
          In Counter-Strike: Source you run at 260 units per second with no
          weapon out, as on most bhop servers. Bunnyhopping, or bhop, is how you
          go faster than that: you keep jumping, and while in the air you
          strafe, which adds speed with every turn.
        </p>
        <p>
          Bhop maps are courses built around this: platforms, gaps, ramps and
          turns between a start zone and an end zone. A timer runs from the
          moment you leave the start zone, and the fastest time on each map and
          style is the record.
        </p>
      </>
    ),
  },
  {
    id: "what-is-sourcejump",
    title: "What SourceJump is",
    body: (
      <>
        <p>
          SourceJump keeps the global records for CS:S bhop. Servers around the
          world connect to it: they run the same timer, the same rules and the
          SourceJump plugin, and send their players&apos; best times here. So
          each map and style has one leaderboard instead of one per server, and
          a record set on one server counts everywhere.
        </p>
        <p>
          Each player has a profile with their times on every map, and new
          records show up in the <Link href="/activity">activity</Link> feed.
          Runs come with a replay you can watch, so you can see how the fastest
          players take each map.
        </p>
        <p>
          Any CS:S bhop server can connect.{" "}
          <a href="#connecting-a-server">Connecting a server</a> explains what
          it needs and how to get a key.
        </p>
        <p>
          This is SourceJump 2.0, a rebuild of the original site. Times from
          before 2.0 are kept and marked as pre-2.0, but they don&apos;t count
          toward 2.0 records or ranks.
        </p>
        <p>
          The community decides how SourceJump works: the rules, what counts and
          how records are kept are all settled together on the{" "}
          <a href={discord} rel="noreferrer" target="_blank">
            Discord
          </a>
          . The rules in force are on the <Link href="/ruleset">ruleset</Link>{" "}
          page.
        </p>
      </>
    ),
  },
  {
    id: "first-hops",
    title: "Your first hops",
    body: (
      <>
        <p>
          Most servers play with auto-bhop: you hold the jump key, and the game
          jumps again on the same tick you land. You don&apos;t need to time
          anything. All of the skill is in the strafing.
        </p>
        <ol>
          <li>
            Hold W to get going, jump, and let go of W as soon as you leave the
            ground. W does nothing for you in the air.
          </li>
          <li>Keep holding jump from then on.</li>
          <li>
            Hold A and move the mouse slowly to the left. Before the turn gets
            sharp, switch: let go of A, hold D and move the mouse to the right.
          </li>
          <li>
            Keep switching. The key and the mouse should always point the same
            way, and change together.
          </li>
        </ol>
        <p>
          Start with small, smooth movements and an easy map. Jerky or large
          turns lose speed; it&apos;s better to make many gentle strafes than a
          few big ones.
        </p>
      </>
    ),
  },
  {
    id: "gaining-speed",
    title: "How strafing gains speed",
    body: (
      <>
        <p>
          In the air the game only lets your keys push you a little, and only
          sideways from the way you&apos;re already moving. Holding A while
          turning left keeps that push slightly ahead of your direction of
          travel, so each tick of the turn adds a bit of speed. That&apos;s why
          the key and the mouse have to match.
        </p>
        <ul>
          <li>
            <strong>Holding W</strong> pushes the way you&apos;re already going,
            which adds nothing in the air and drags each strafe off line.
          </li>
          <li>
            <strong>Turning too fast</strong> for your speed loses speed;
            turning too slowly gains little. The faster you go, the smoother the
            turn has to be.
          </li>
          <li>
            <strong>Sync</strong> is the share of the time your key matched your
            mouse. Many servers show it after each jump, which makes it a good
            thing to watch while practising.
          </li>
          <li>
            <strong>Landing</strong>: with auto-bhop you leave the ground the
            tick you touch it, so friction barely has time to slow you. Each
            tick you stay on the ground brings you closer to running speed
            again.
          </li>
          <li>
            <strong>Hitting walls</strong> or the edges of platforms costs
            speed, so the line you take matters as much as the strafes.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "styles",
    title: "Styles",
    body: (
      <>
        <p>
          A style is a variant of the rules with its own leaderboard. The common
          ones:
        </p>
        <ul>
          <li>
            <strong>Normal</strong>: auto-bhop, with every key allowed. What
            most people play.
          </li>
          <li>
            <strong>Scroll</strong>: no auto-bhop. You press jump yourself as
            you land, usually with the mouse wheel; a late jump costs speed.
          </li>
          <li>
            <strong>Sideways</strong>: only W and S, strafing while facing
            sideways.
          </li>
          <li>
            <strong>Half-sideways</strong>: W held together with A or D,
            strafing while facing diagonally.
          </li>
          <li>
            <strong>W-only</strong>: only W, steering with the mouse alone.
          </li>
          <li>
            <strong>A/D-only</strong>: only A and D, as in the guide above.
          </li>
        </ul>
        <p>
          Which styles count on SourceJump is listed on the{" "}
          <Link href="/ruleset">ruleset</Link> page.
        </p>
      </>
    ),
  },
  {
    id: "playing",
    title: "Playing on a server",
    body: (
      <>
        <p>
          You need Counter-Strike: Source from Steam. Pick a server marked
          Connected in the <Link href="/servers">server list</Link>: only runs
          on <a href="#connecting-a-server">connected servers</a> count here.
        </p>
        <p>
          Every server runs the same timer, so the same{" "}
          <a href="#commands">commands</a> work everywhere.
        </p>
        <p>
          When you finish a run faster than your previous best, the server sends
          it to SourceJump. It shows up on the map&apos;s{" "}
          <Link href="/maps">leaderboard</Link>, your profile and{" "}
          <Link href="/activity">activity</Link>.
        </p>
      </>
    ),
  },
  {
    id: "commands",
    title: "Commands",
    body: (
      <>
        <p>
          Type these in chat. Most have longer names too, such as{" "}
          <code>!restart</code> for <code>!r</code>. A server can turn some off
          or add its own.
        </p>
        <dl>
          {commands.map(([name, what]) => (
            <Term key={name} name={<code>{name}</code>}>
              {what}
            </Term>
          ))}
        </dl>
        <p>
          <Link href="/help/commands">All commands</Link> lists every command on
          a SourceJump server, with its other names and who can use it.
        </p>
      </>
    ),
  },
  {
    id: "words",
    title: "Words you'll see",
    body: (
      <dl>
        <Term name="u/s">
          Units per second, the game&apos;s measure of speed. Running is 260.
        </Term>
        <Term name="Strafe">
          One turn in the air with one key held: A while turning left, D while
          turning right.
        </Term>
        <Term name="Sync">
          How much of the time your key matched the direction you were turning.
        </Term>
        <Term name="Gain">How well a strafe turned into speed.</Term>
        <Term name="Style">A rule variant with its own leaderboard.</Term>
        <Term name="Zones">
          The start and end areas of a map; the timer runs between them.
        </Term>
        <Term name="Bonus">
          A separate, usually shorter course on the same map, with its own
          times.
        </Term>
        <Term name="PB, WR">
          Personal best: your fastest time. World record: the fastest time
          anyone has set.
        </Term>
        <Term name="Tick">
          One step of the game&apos;s simulation. Bhop servers usually run 100
          ticks a second.
        </Term>
      </dl>
    ),
  },
  {
    id: "connecting-a-server",
    title: "Connecting a server",
    body: (
      <>
        <p>
          Any CS:S server can run the{" "}
          <a href={pluginRepo} rel="noreferrer" target="_blank">
            SourceJump plugin
          </a>
          . It comes in one download with shavit&apos;s bhoptimer already set
          up, and gives your server SourceJump&apos;s zones for every map, the
          global records in game (<code>!wrsj</code>) and the standard movement
          fixes. It keeps itself up to date.
        </p>
        <p>
          For your players&apos; times to be sent to SourceJump, the server also
          needs an API key:
        </p>
        <ol>
          <li>
            Install SourceMod, then extract the plugin&apos;s download into{" "}
            <code>cstrike/</code>.
          </li>
          <li>
            Ask for a key on the{" "}
            <a href={discord} rel="noreferrer" target="_blank">
              Discord
            </a>{" "}
            with your server&apos;s name and address. Staff issue it and add the
            server to the <Link href="/servers">server list</Link>.
          </li>
          <li>
            Put the key in <code>cfg/sourcemod/sourcejump.cfg</code> and
            restart. <code>sm_sj_status</code> in the server console shows
            whether the server is connected.
          </li>
        </ol>
        <p>
          From then on the server shows as Connected, and when a player beats
          their SourceJump personal best on a ranked style, it sends the run and
          its replay.
        </p>
        <p>
          The plugin checks the server against the{" "}
          <Link href="/ruleset">ruleset</Link> and sets the required cvars
          itself. Anything else the ruleset requires, such as the BASH
          anti-cheat, is listed there.
        </p>
        <p>
          <strong>Keep the key private.</strong> It&apos;s how SourceJump knows
          a time came from your server. If it leaks, ask for a new one: the old
          one stops working.
        </p>
        <p>
          <strong>Other styles</strong> are fine: your server can run any styles
          it likes. Only ranked styles are sent; the rest stay on your server.
        </p>
      </>
    ),
  },
  {
    id: "questions",
    title: "Questions",
    body: (
      <p>
        Ask on the SourceJump{" "}
        <a href={discord} rel="noreferrer" target="_blank">
          Discord
        </a>
        . Players there can help you get started.
      </p>
    ),
  },
];

export function HelpGuide() {
  return (
    <>
      {/* Near the top: a video shows the movement better than any text, so it's the first thing to try. */}
      <a
        href={beginnerPlaylist}
        rel="noreferrer"
        target="_blank"
        className="group block"
      >
        <Card interactive className="flex items-center gap-4">
          <span className="bg-accent-soft text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
            <CirclePlay aria-hidden className="size-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-bold">
              Watch: Linguistie&apos;s beginner series on auto-bhop
            </span>
            <span className="text-text-muted text-sm">
              The basics step by step, on YouTube. Made for CS:GO, but the
              movement is the same in CS:S.
            </span>
          </span>
          <ArrowUpRight
            aria-hidden
            className="text-text-subtle group-hover:text-accent size-4 shrink-0 transition-colors duration-(--duration-fast)"
          />
        </Card>
      </a>
      <nav aria-label="On this page">
        <ol className="text-text-muted gap-x-6 text-sm sm:columns-2 [&>li]:py-0.5">
          {sections.map(({ id, title }) => (
            <li key={id}>
              <a href={`#${id}`} className="hover:text-accent">
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map(({ id, title, body }) => (
        <section
          key={id}
          id={id}
          aria-labelledby={`${id}-title`}
          className={classNames(
            "flex scroll-mt-20 flex-col gap-4 leading-relaxed",
            "[&_a]:text-accent [&_a]:underline-offset-4 [&_a:hover]:underline",
            "[&_li+li]:mt-1 [&_ol]:list-decimal [&_ol,&_ul]:pl-6 [&_ul]:list-disc",
            "[&_code]:bg-surface-raised [&_code]:rounded-sm [&_code]:px-1 [&_code]:text-sm",
          )}
        >
          <h2 id={`${id}-title`} className="mt-4 text-xl font-bold">
            {title}
          </h2>
          {body}
        </section>
      ))}
    </>
  );
}

function Term({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-1 border-b py-2 sm:flex-row sm:gap-4">
      <dt className="shrink-0 font-bold sm:w-32">{name}</dt>
      <dd className="text-text-muted">{children}</dd>
    </div>
  );
}
