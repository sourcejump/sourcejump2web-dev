// A table heading that sorts its column when pressed, with an arrow for the direction on the active one. Goes
// inside a TableHeaderCell, which carries `aria-sort`.
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { classNames } from "./classNames";

/**
 * A heading that sorts its column. The arrow hangs outside the label, so the label stays centered or aligned
 * over its column whether or not the arrow shows.
 */
export function SortButton({
  label,
  active,
  descending,
  onClick,
}: {
  label: ReactNode;
  active: boolean;
  descending: boolean;
  onClick: () => void;
}) {
  const Arrow = descending ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "relative cursor-pointer uppercase transition-colors duration-(--duration-fast)",
        active ? "text-text" : "hover:text-text",
      )}
    >
      {label}
      {active && (
        <Arrow
          aria-hidden
          className="absolute top-1/2 left-full ml-0.5 size-3.5 -translate-y-1/2"
        />
      )}
    </button>
  );
}
