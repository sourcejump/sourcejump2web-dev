// The content area of every page: its width and padding, and the fade between pages.
import { type ReactNode, ViewTransition } from "react";
import { classNames } from "./classNames";

/**
 * React runs `enter` when a page's content mounts and `exit` when it unmounts during a navigation,
 * so the old page fades out and the new one fades in (motion.css, `.page-fade`). It has to wrap each
 * page rather than sit in the layout: layouts persist across navigations, so they never enter or exit.
 */
export function Page({
  width = "wide",
  className,
  children,
}: {
  /**
   * `narrow` is a reading width for text-heavy pages; `medium` for a single table that would stretch thin. `fill` is for pages inside a section layout that
   * already sets the width and padding, such as the staff area with its sidebar.
   */
  width?: "wide" | "medium" | "narrow" | "fill";
  className?: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition enter="page-fade" exit="page-fade" default="none">
      <main
        className={classNames(
          "flex w-full flex-1 flex-col",
          width === "fill" ? "min-w-0" : "mx-auto px-4 pt-6 pb-10 sm:px-8",
          width === "narrow" && "max-w-3xl",
          width === "medium" && "max-w-content",
          width === "wide" && "max-w-full",
          className,
        )}
      >
        {children}
      </main>
    </ViewTransition>
  );
}

/**
 * One of a page's views under a layout that stays, such as a map and its Manage view: switching views
 * fades the old one out and lifts the new one in (`view-flip` in motion.css), while the header and banner
 * in the layout stay where they are.
 */
export function PageView({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition enter="view-flip" exit="view-flip" default="none">
      <div className={classNames("flex flex-col gap-6", className)}>
        {children}
      </div>
    </ViewTransition>
  );
}
