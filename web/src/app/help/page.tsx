// Help page for a new player: what bunnyhopping and SourceJump are, and how to start bhopping.
import type { Metadata } from "next";
import { HelpGuide } from "@/features/help/HelpGuide";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Help",
  description:
    "What bunnyhopping and SourceJump are, how to strafe and gain speed, the styles, and how to start playing.",
};

export default function HelpPage() {
  return (
    <Page width="narrow" className="gap-6">
      <h1 className="text-3xl font-bold">Getting started</h1>
      <p>
        A guide for new players: what bunnyhopping is, what SourceJump is, and
        how to start bhopping.
      </p>
      <HelpGuide />
    </Page>
  );
}
