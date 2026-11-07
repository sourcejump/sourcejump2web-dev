// How tabs look, shared by Tabs (panels on one page), LinkTabs (views with their own address) and Segmented.
export type TabVariant = "underline" | "segmented";

/** `idle` and `active` never apply together, so their colors don't compete. */
export const tabStyles: Record<
  TabVariant,
  { list: string; tab: string; idle: string; active: string }
> = {
  underline: {
    list: "flex gap-6 border-b border-border",
    tab: "-mb-px border-b-2 py-2",
    idle: "border-transparent text-text-muted hover:text-text",
    active: "border-accent text-accent",
  },
  segmented: {
    list: "inline-flex gap-1 rounded-md border border-border bg-surface p-0.5 sm:p-1",
    // Smaller on phones, as tall as the menus beside it (32px) and narrow enough to share their line.
    tab: "h-[26px] rounded-sm px-2 text-xs sm:h-7 sm:px-3 sm:text-sm",
    idle: "text-text-muted hover:bg-surface-raised hover:text-text",
    // Accent, like the underline variant: the chosen option has to be obvious at a glance (lead, 2026-10-20).
    active: "bg-accent-soft text-accent",
  },
};
