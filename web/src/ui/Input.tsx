// A single-line text field, optionally with a leading icon (e.g. search).
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { classNames } from "./classNames";

export function Input({
  icon: Icon,
  size = "md",
  className,
  ...props
}: {
  icon?: LucideIcon;
  /** `sm` matches the height of a ChoiceMenu, for a field in a row of them. */
  size?: "sm" | "md";
} & Omit<ComponentProps<"input">, "size">) {
  return (
    <span className={classNames("relative flex items-center", className)}>
      {Icon && (
        <Icon
          aria-hidden
          className="text-text-subtle pointer-events-none absolute left-3 size-4"
        />
      )}
      <input
        className={classNames(
          "border-border bg-bg text-text w-full rounded-md border px-3 text-sm",
          size === "sm" ? "h-9" : "h-10",
          "placeholder:text-text-subtle transition-colors duration-(--duration-fast)",
          "hover:border-border-strong focus:border-accent focus:outline-none",
          Icon && "pl-9",
        )}
        {...props}
      />
    </span>
  );
}
