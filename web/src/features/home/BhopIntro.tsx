// The home page's introduction to bunnyhopping: what it is, the demo, and the three things a player does in a
// line each, with the help page for the rest.
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/ui/Link";
import { BhopDemo } from "./BhopDemo";

// Written for someone who has never bhopped: auto-bhop is what most players play, so the jump key is held, not
// timed, and the skill shown is strafing (feedback from the community, 2026-11-09).
const steps: { title: string; body: string; keys: ReactNode }[] = [
  {
    title: "Hold jump",
    body: "Auto-bhop jumps again the moment you land. In the Scroll style you time each jump yourself.",
    keys: <Key>Jump</Key>,
  },
  {
    title: "Strafe, don't run",
    body: "Let go of W. Hold A while turning the mouse left, D while turning right, and switch smoothly.",
    keys: (
      <>
        <Key>A</Key>
        <Key>D</Key>
      </>
    ),
  },
  {
    title: "Build speed",
    body: "Each clean strafe adds speed in the air. Sloppy strafes and holding W lose it. Speed is shown in units per second (u/s).",
    keys: <Key>u/s</Key>,
  },
];

export function BhopIntro() {
  return (
    <section className="flex flex-col gap-6" aria-labelledby="bhop-intro">
      <div className="flex flex-col gap-3">
        <h2 id="bhop-intro" className="text-3xl font-bold">
          Speed from jumping and strafing
        </h2>
        <p className="text-text-muted max-w-prose">
          Bunnyhopping is a way of moving in Source games: by jumping and
          strafing in the air, you build speed far past the normal running
          limit. Bhop maps are courses run against the clock, and SourceJump
          keeps the global records.{" "}
          <Link
            href="/help"
            aria-label="Read more about bhop and SourceJump"
            className="text-accent group inline-flex items-center gap-1 font-bold underline-offset-4 hover:underline"
          >
            Read more
            <ArrowRight
              aria-hidden
              className="size-4 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
            />
          </Link>
        </p>
      </div>
      <BhopDemo />
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((step) => (
          <li key={step.title} className="motion-reveal flex gap-3">
            <span className="flex shrink-0 gap-1">{step.keys}</span>
            <span className="flex flex-col">
              <span className="font-bold">{step.title}</span>
              <span className="text-text-muted text-sm">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <span className="border-border bg-surface text-accent flex h-7 min-w-7 items-center justify-center rounded-sm border px-1.5 text-xs font-bold whitespace-nowrap uppercase">
      {children}
    </span>
  );
}
