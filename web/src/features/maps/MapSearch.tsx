"use client";
// The Maps page's search box: the list follows as you type, once typing pauses, with no Search button.
import { Search } from "lucide-react";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/ui/Input";

/** Long enough to skip the keystrokes in the middle of a word, short enough to feel like it follows along. */
const PAUSE_MS = 300;

export function MapSearch({
  q,
  keep,
  className,
}: {
  /** The search the page was rendered with. */
  q: string;
  /** The page's other choices (tab, sort, style, tier, completion), kept as the search changes. */
  keep: Record<string, string>;
  className?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  // The search this box last sent. When the page comes back with a different one (a link that clears the search,
  // or Back), the box takes it; when it comes back with the one sent, the box keeps what has been typed since.
  const [sent, setSent] = useState(q);
  const [renderedQ, setRenderedQ] = useState(q);
  if (q !== renderedQ) {
    setRenderedQ(q);
    if (q !== sent) {
      setValue(q);
      setSent(q);
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (text: string) => {
    const typed = text.trim();
    if (typed === sent) return;
    setSent(typed);
    const query = new URLSearchParams(keep);
    if (typed) query.set("q", typed);
    const params = query.toString();
    // Replaced rather than pushed, so Back leaves the page instead of stepping through every pause. Leaving out
    // `page` starts a new search on its first page.
    router.replace(params ? `/maps?${params}` : "/maps", { scroll: false });
  };

  return (
    // A plain form underneath, so Enter searches at once and the box works before scripts load.
    <Form
      action="/maps"
      prefetch={false}
      role="search"
      className={className}
      onSubmit={() => {
        clearTimeout(timer.current);
        setSent(value.trim());
      }}
    >
      {Object.entries(keep).map(([name, kept]) => (
        <input key={name} type="hidden" name={name} value={kept} />
      ))}
      <Input
        icon={Search}
        type="search"
        name="q"
        value={value}
        onChange={(event) => {
          const text = event.target.value;
          setValue(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => search(text), PAUSE_MS);
        }}
        placeholder="Map name, or a SteamID for their maps"
        aria-label="Search maps, or enter a SteamID"
        size="sm"
      />
    </Form>
  );
}
