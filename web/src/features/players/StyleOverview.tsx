"use client";
// A profile's personal bests by style: a donut beside every style in the ruleset with its count. A slice or a
// row picks that style for the whole profile, as the Style menu does; styles without personal bests are listed
// with 0, dimmed, and draw no slice.
import { type CSSProperties, type MouseEvent, useState } from "react";
import { classNames } from "@/ui/classNames";
import { Donut } from "@/ui/Donut";

const number = new Intl.NumberFormat("en");
const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 0,
});

export type StyleCount = {
  key: string;
  name: string;
  /** Personal bests, bonuses included. */
  count: number;
  color: string;
};

export function StyleOverview({
  styles,
  selected,
  href,
  onChoose,
}: {
  /** In the ruleset's order. */
  styles: StyleCount[];
  /** The chosen style's key, or none for every style. */
  selected: string | undefined;
  /** The address of the profile showing a style, for the slices' links. */
  href: (style: string) => string;
  onChoose: (style: string) => void;
}) {
  const [hovered, setHovered] = useState<string>();
  const total = styles.reduce((sum, style) => sum + style.count, 0);
  const chosen = styles.find((style) => style.key === selected);
  const pick = (key: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onChoose(key);
  };

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <Donut
        label={`${number.format(total)} personal bests: ${styles
          .filter((style) => style.count > 0)
          .map((style) => `${style.name} ${number.format(style.count)}`)
          .join(", ")}`}
        selected={selected}
        highlighted={hovered}
        slices={styles.map((style) => ({
          key: style.key,
          value: style.count,
          color: style.color,
          label: `${style.name}: ${number.format(style.count)} personal bests`,
          href: href(style.key),
          onClick: pick(style.key),
        }))}
        value={number.format(chosen ? chosen.count : total)}
        caption={chosen ? chosen.name : "personal bests"}
      />
      <ul className="flex w-full min-w-0 flex-1 flex-col text-sm">
        {styles.map((style) => {
          const on = selected === style.key;
          const dimmed = style.count === 0 || (selected != null && !on);
          return (
            <li key={style.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChoose(style.key)}
                onPointerEnter={() => setHovered(style.key)}
                onPointerLeave={() => setHovered(undefined)}
                onFocus={() => setHovered(style.key)}
                onBlur={() => setHovered(undefined)}
                className={classNames(
                  "hover:bg-surface-raised flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left transition duration-(--duration-base)",
                  on && "bg-surface-raised",
                  dimmed && "opacity-45 hover:opacity-100",
                )}
              >
                <span
                  aria-hidden
                  style={{ "--swatch": style.color } as CSSProperties}
                  className="size-2.5 shrink-0 rounded-sm bg-(--swatch)"
                />
                <span className="min-w-0 flex-1 truncate">{style.name}</span>
                <span className="tabular-nums">
                  {number.format(style.count)}
                </span>
                <span className="text-text-subtle w-10 text-right text-xs tabular-nums">
                  {style.count > 0 && total > 0
                    ? percent.format(style.count / total)
                    : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
