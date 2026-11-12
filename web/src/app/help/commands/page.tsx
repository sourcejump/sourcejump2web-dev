// Commands page: every command the timer and the SourceJump plugin add on a connected server, by plugin.
import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { CommandsBrowser, Code } from "@/features/help/CommandsBrowser";
import { adminFlags } from "@/features/help/commands";
import { Card, Label } from "@/ui/Card";
import { PageView } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Commands",
  description:
    "Every command on a SourceJump server, by plugin: other names, who can use it and what it does.",
};

export default function CommandsPage() {
  return (
    <PageView>
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="text-3xl font-bold">Commands</h1>
        <p className="text-text-muted">
          Every command in SourceJump&apos;s server release (0.3.22):
          shavit&apos;s timer and the SourceJump plugin. A server can turn some
          off or add its own.
        </p>
      </div>
      <Card className="grid gap-5 sm:grid-cols-3">
        <HowTo label="In chat" example={["!r", "/r"]}>
          <Code>/</Code> keeps it out of chat. Upper case works too:{" "}
          <Code>!R</Code>.
        </HowTo>
        <HowTo label="In the console" example={["sm_r"]}>
          Every command works with <Code>sm_</Code> in front.
        </HowTo>
        <HowTo label="Admin commands" example={[]}>
          Need a SourceMod admin flag:{" "}
          {Object.entries(adminFlags).map(([flag, name], index, all) => (
            <Fragment key={flag}>
              <span className="whitespace-nowrap">
                <Code>{flag}</Code> {name}
              </span>
              {index < all.length - 1 ? ", " : "."}
            </Fragment>
          ))}
        </HowTo>
      </Card>
      <CommandsBrowser />
    </PageView>
  );
}

function HowTo({
  label,
  example,
  children,
}: {
  label: string;
  example: string[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {example.length > 0 && (
        <p className="text-accent text-lg font-bold">
          {example.map((name, index) => (
            <span key={name}>
              {index > 0 && <span className="text-text-subtle"> or </span>}
              <code>{name}</code>
            </span>
          ))}
        </p>
      )}
      <p className="text-text-muted text-sm">{children}</p>
    </div>
  );
}
