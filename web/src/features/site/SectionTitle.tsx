// The heading of a page that the header's navigation names, such as Maps or Servers.

/**
 * Hidden on screen, because the highlighted header link already says which page this is and a visible
 * "Maps" above the maps only repeats it (lead, 2026-11-09). It stays in the page for screen readers, which
 * jump between pages by their headings, and for search engines, which read the `<h1>` as the page's
 * subject. Pages the header doesn't name (a map, a player, "New post") show a visible heading instead.
 */
export function SectionTitle({ children }: { children: string }) {
  return <h1 className="sr-only">{children}</h1>;
}
