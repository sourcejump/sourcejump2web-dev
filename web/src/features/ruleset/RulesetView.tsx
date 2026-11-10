// The current ruleset, as `GET /v1/ruleset` serves it.
import type { ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { currentRuleset } from "./currentRuleset";

const publishedDate = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export async function RulesetView() {
  const ruleset = await currentRuleset().catch(() => undefined);

  if (!ruleset) {
    return (
      <p>
        {ruleset === null
          ? "No ruleset has been published yet."
          : "The ruleset couldn't be loaded. Try again in a moment."}
      </p>
    );
  }
  return <RulesetDetails ruleset={ruleset} />;
}

function RulesetDetails({ ruleset }: { ruleset: Schemas["Ruleset"] }) {
  const cvars = Object.entries(ruleset.cvars);
  const features = Object.entries(ruleset.features);

  return (
    // Laid out like the help page, its neighbour in the footer: titled sections of rows with a line under each.
    <div className="[&_code]:bg-surface-raised flex flex-col gap-4 leading-relaxed [&_code]:rounded-sm [&_code]:px-1 [&_code]:text-sm">
      <p className="text-text-muted">
        Version {ruleset.version}, published{" "}
        <time dateTime={ruleset.published_at}>
          {publishedDate.format(new Date(ruleset.published_at))}
        </time>
        . Plugin {ruleset.plugin.min_version} or newer.
      </p>

      <Section title="Ranked styles">
        <dl>
          {ruleset.styles.map((style) => (
            <Row key={style.key} name={style.name}>
              <code>{style.key}</code>
            </Row>
          ))}
        </dl>
      </Section>

      <Section title="Required cvars">
        {cvars.length === 0 ? (
          <None />
        ) : (
          <dl>
            {cvars.map(([name, value]) => (
              <Row key={name} name={<code>{name}</code>}>
                <code>{value}</code>
              </Row>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Required plugins">
        {ruleset.plugins.required.length === 0 ? (
          <None />
        ) : (
          <dl>
            {ruleset.plugins.required.map((plugin) => (
              <Row key={plugin.name} name={plugin.name}>
                {plugin.versions.length === 0
                  ? "Any version"
                  : plugin.versions.join(", ")}
              </Row>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Forbidden plugins">
        {ruleset.plugins.forbidden.length === 0 ? (
          <None />
        ) : (
          <dl>
            {ruleset.plugins.forbidden.map((plugin) => (
              <Row
                key={`${plugin.name}:${plugin.file_hash}`}
                name={plugin.name ?? "Unnamed"}
              >
                {plugin.file_hash && <code>{plugin.file_hash}</code>}
              </Row>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Zones">
        <dl>
          <Row name="Loaded from">
            {/* An address has no spaces to wrap at, so it breaks anywhere rather than run off a phone's screen. */}
            <code className="break-all">{ruleset.zones.source_url}</code>
          </Row>
          <Row name="Zone types SourceJump controls">
            {ruleset.zones.controlled_types.join(", ")}
          </Row>
        </dl>
      </Section>

      <Section title="Features">
        {features.length === 0 ? (
          <None />
        ) : (
          <dl>
            {features.map(([name, enabled]) => (
              <Row key={name} name={<code>{name}</code>}>
                {enabled ? "On" : "Off"}
              </Row>
            ))}
          </dl>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** One rule: its name, and its value beside it (under it on a phone). */
function Row({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-1 border-b py-2 sm:flex-row sm:gap-4">
      <dt className="shrink-0 font-bold sm:w-64">{name}</dt>
      <dd className="text-text-muted min-w-0">{children}</dd>
    </div>
  );
}

function None() {
  return <p className="text-text-muted">None.</p>;
}
