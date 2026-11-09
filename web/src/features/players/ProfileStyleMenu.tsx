"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { Schemas } from "@/api/client";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { LEGACY_STYLE } from "@/features/legacy/views";

export function ProfileStyleMenu({
  player,
  styleOrder,
  styleNames,
}: {
  player: Schemas["PlayerProfile"];
  styleOrder: string[];
  styleNames: Record<string, string>;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const keys = [
    ...styleOrder,
    ...player.styles
      .map((s) => s.style)
      .filter((key) => !styleOrder.includes(key)),
  ];
  const hasTimes = (key: string) =>
    player.styles.some((s) => s.style === key) ||
    (key === LEGACY_STYLE && player.legacy_maps > 0);
  const selected =
    ["any", ...keys].find((key) => key === params.get("style")) ??
    keys.find(hasTimes) ??
    keys[0];
  if (!selected || pathname.endsWith("/manage")) return null;
  return (
    <ChoiceMenu
      label="Style"
      value={selected}
      options={[
        { value: "any", label: "Any" },
        ...keys.map((key, index) => ({
          value: key,
          label: styleNames[key] ?? key,
          quiet: !hasTimes(key),
          startsGroup: index === 0,
        })),
      ]}
      onChange={(style) => {
        const url = new URL(window.location.href);
        url.searchParams.set("style", style);
        url.searchParams.delete("view");
        window.history.replaceState(null, "", url);
      }}
    />
  );
}
