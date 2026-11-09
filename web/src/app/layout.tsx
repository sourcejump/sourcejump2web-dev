// Root layout: fonts, global styles, the header and footer, the run dialog, and site-wide metadata.
import type { Metadata } from "next";
import { Exo_2, Geist } from "next/font/google";
import { Suspense } from "react";
import { RunDialogHost } from "@/features/runs/RunDialogHost";
import { SiteFooter } from "@/features/site/SiteFooter";
import { SiteHeader } from "@/features/site/SiteHeader";
import { NavigationProgress } from "@/ui/NavigationProgress";
import "./globals.css";

// A variable font, so the in-between weights the type tokens use (tokens.css) load in the one file.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin", "latin-ext", "cyrillic"],
});
// Game servers' names (the `font-server` token): a bold face with more character than Geist, in its one weight.
const exo = Exo_2({
  variable: "--font-exo",
  weight: "700",
  subsets: ["latin", "latin-ext", "cyrillic"],
});

export const metadata: Metadata = {
  title: { default: "SourceJump", template: "%s · SourceJump" },
  description:
    "Global records for the Counter-Strike: Source bunnyhop community.",
};

// Pages wait for their data and arrive whole; the progress bar covers the wait.
export const instant = false;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${exo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NavigationProgress />
        {/* Keep the footer below the fold so short pages don't change the scrollbar width. */}
        <div className="flex min-h-svh flex-col">
          <SiteHeader />
          <div className="max-w-site mx-auto flex w-full flex-1 flex-col pb-16">
            {children}
          </div>
        </div>
        <SiteFooter />
        {/* The run dialog, over whichever page opened it (`?run=` in the address). */}
        <Suspense>
          <RunDialogHost />
        </Suspense>
      </body>
    </html>
  );
}
