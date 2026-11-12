// Help page for a new player: what bunnyhopping and SourceJump are, and how to start bhopping.
import type { Metadata } from "next";
import { HelpGuide } from "@/features/help/HelpGuide";
import { PageView } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Help",
  description:
    "What bunnyhopping and SourceJump are, how to strafe and gain speed, the styles, and how to start playing.",
};

export default function HelpPage() {
  return (
    // A reading width: the help layout around it is as wide as the Commands page's tables need.
    <PageView className="max-w-3xl">
      <h1 className="text-3xl font-bold">Getting started</h1>
      <p>
        A guide for new players: what bunnyhopping is, what SourceJump is, and
        how to start bhopping.
      </p>
      <HelpGuide />
    </PageView>
  );
}
