// The help pages: their tabs stay while the page under them changes. Add a page here and as a route under app/help.
import { PathTabs } from "@/ui/PathTabs";
import { Page } from "@/ui/Page";

const helpPages = [
  { href: "/help", label: "Getting started" },
  { href: "/help/commands", label: "Commands" },
];

export default function HelpLayout({ children }: LayoutProps<"/help">) {
  return (
    <Page className="gap-6">
      <PathTabs label="Help pages" tabs={helpPages} className="self-start" />
      {children}
    </Page>
  );
}
