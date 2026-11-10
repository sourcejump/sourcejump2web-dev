// Help page: bunnyhopping explained for a new player, from the first hop to how a run reaches SourceJump.
import type { Metadata } from "next";
import { HelpGuide } from "@/features/help/HelpGuide";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Help",
  description:
    "What bunnyhopping is, how to strafe and gain speed, the styles, and how your runs reach SourceJump.",
};

export default function HelpPage() {
  return (
    <Page width="narrow" className="gap-6">
      <h1 className="text-3xl font-bold">How bhop works</h1>
      <p>
        A guide for new players: what bunnyhopping is, how to gain speed, and
        how your runs end up on SourceJump.
      </p>
      <HelpGuide />
    </Page>
  );
}
