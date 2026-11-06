// Ruleset page: the rules every connected server applies.
import type { Metadata } from "next";
import { RulesetView } from "@/features/ruleset/RulesetView";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Ruleset",
  description: "The rules every server connected to SourceJump applies.",
};

export default function RulesetPage() {
  return (
    <Page width="narrow" className="gap-6">
      <h1 className="text-3xl font-bold">Ruleset</h1>
      <p>
        The rules every connected server applies. Each run records the ruleset
        version it was played under.
      </p>
      <RulesetView />
    </Page>
  );
}
