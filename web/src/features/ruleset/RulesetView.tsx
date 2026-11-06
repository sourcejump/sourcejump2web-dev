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
    <div className="flex flex-col gap-8">
      <p>
        Version {ruleset.version}, published{" "}
        <time dateTime={ruleset.published_at}>
          {publishedDate.format(new Date(ruleset.published_at))}
        </time>
        . Plugin {ruleset.plugin.min_version} or newer.
      </p>

      <Section title="Ranked styles">
        <ul>
          {ruleset.styles.map((style) => (
            <li key={style.key}>
              {style.name} <code className="opacity-70">{style.key}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Required cvars">
        {cvars.length === 0 ? (
          <p>None.</p>
        ) : (
          <table className="self-start">
            <tbody>
              {cvars.map(([name, value]) => (
                <tr key={name}>
                  <td className="pr-6">
                    <code>{name}</code>
                  </td>
                  <td>
                    <code>{value}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Required plugins">
        <ul>
          {ruleset.plugins.required.map((plugin) => (
            <li key={plugin.name}>
              {plugin.name}:{" "}
              {plugin.versions.length === 0
                ? "any version"
                : plugin.versions.join(", ")}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Forbidden plugins">
        {ruleset.plugins.forbidden.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {ruleset.plugins.forbidden.map((plugin) => (
              <li key={`${plugin.name}:${plugin.file_hash}`}>
                {[plugin.name, plugin.file_hash].filter(Boolean).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Zones">
        <p>
          Loaded from <code>{ruleset.zones.source_url}</code>. SourceJump
          controls these zone types: {ruleset.zones.controlled_types.join(", ")}
          .
        </p>
      </Section>

      <Section title="Features">
        {features.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {features.map(([name, enabled]) => (
              <li key={name}>
                <code>{name}</code>: {enabled ? "on" : "off"}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}
