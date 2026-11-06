// Root layout: fonts, global styles, the header and footer, the run dialog, and site-wide metadata.
import type { Metadata } from "next";
import { Play } from "next/font/google";
import { Suspense } from "react";
import { RunDialogHost } from "@/features/runs/RunDialogHost";
import { SiteFooter } from "@/features/site/SiteFooter";
import { SiteHeader } from "@/features/site/SiteHeader";
import { NavigationProgress } from "@/ui/NavigationProgress";
import "./globals.css";

const play = Play({
  variable: "--font-play",
  weight: ["400", "700"],
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
    <html lang="en" className={`${play.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NavigationProgress />
        {/* The header and page fill at least the window, so the footer starts right at the fold: the page
            always scrolls, and the scrollbar doesn't come and go between short and long pages. The space
            above the footer is padding in here, not a margin on the footer, so it doesn't push it lower. */}
        <div className="flex min-h-svh flex-col">
          <SiteHeader />
          <div className="flex flex-1 flex-col pb-16">{children}</div>
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
