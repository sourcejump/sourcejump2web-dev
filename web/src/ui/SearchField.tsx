// A search field with its button inside on the right, as the old sourcejump.net had it. Focus looks as the
// header search's does: the border turns accent and the field darkens, with no ring around it. Goes inside the
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
        className="peer border-border bg-surface text-text placeholder:text-text-subtle hover:border-border-strong focus:border-accent focus:bg-bg h-10 w-full rounded-md border pr-11 pl-3.5 transition-colors duration-(--duration-fast) outline-none"
      />
      <button
        type="submit"
        aria-label="Search"
        className="text-text-muted hover:text-accent peer-focus:text-accent absolute inset-y-1 right-1 grid w-9 place-items-center rounded-sm transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
      >
        <Search aria-hidden className="size-4" />
      </button>
    </div>
  );
}
