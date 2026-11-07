// A search field with its button inside on the right, as the old sourcejump.net had it. Goes inside the
// caller's form, which does the searching.
import { Search } from "lucide-react";

export function SearchField({
  name,
  defaultValue,
  placeholder,
  label,
}: {
  name: string;
  defaultValue?: string;
  placeholder: string;
  /** Names the field for screen readers, since the placeholder isn't a label. */
  label: string;
}) {
  return (
    <div className="relative w-full">
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={label}
        className="peer bg-surface-raised text-text placeholder:text-text-subtle h-12 w-full rounded-md pr-13 pl-4.5 shadow-[inset_0_0_0_1px_var(--color-border)] transition-shadow duration-(--duration-base) outline-none hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)] focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)]"
      />
      <button
        type="submit"
        aria-label="Search"
        className="text-text-muted hover:text-accent peer-focus-visible:text-accent absolute inset-y-1 right-1 grid w-10 place-items-center rounded-sm transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
      >
        <Search aria-hidden className="size-5" />
      </button>
    </div>
  );
}
