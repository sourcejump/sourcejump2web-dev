// Root layout: fonts, global styles, the header and footer, the run dialog, and site-wide metadata.
import type { Metadata } from "next";
import Image from "next/image";
import { Play } from "next/font/google";
import { Suspense } from "react";
import art from "@/features/site/header-interloper.webp";
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
        {/* What shows in the gutters either side of the sheet: the header's map picture, blurred and darkened
            far back, fixed while the page scrolls. Blurred anyway, so a small copy of it is plenty. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <Image
            src={art}
            alt=""
            sizes="640px"
            quality={75}
            className="size-full scale-110 object-cover opacity-80 blur-lg"
          />
          <div className="from-gutter/10 to-gutter/85 absolute inset-0 bg-linear-to-b" />
        </div>
        {/* The sheet, as the old sourcejump.net had it: one column down the middle of the window, edges lit,
            holding the header, the page and the footer, the gutters either side. */}
        <div className="bg-bg shadow-sheet mx-auto flex w-full max-w-6xl flex-1 flex-col">
          {/* The header and page fill at least the window, so the footer starts right at the fold: the page
              always scrolls, and the scrollbar doesn't come and go between short and long pages. The space
              above the footer is padding in here, not a margin on the footer, so it doesn't push it lower. */}
          <div className="flex min-h-svh flex-col">
            <SiteHeader />
            <div className="flex flex-1 flex-col pb-16">{children}</div>
          </div>
          <SiteFooter />
        </div>
        {/* The run dialog, over whichever page opened it (`?run=` in the address). */}
        <Suspense>
          <RunDialogHost />
        </Suspense>
      </body>
    </html>
  );
}
