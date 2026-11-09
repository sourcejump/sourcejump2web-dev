// Who wrote a post and when, under its title.
import type { Schemas } from "@/api/client";
import { formatDate } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { Link } from "@/ui/Link";
import { avatarSrc } from "@/features/players/avatarSrc";
import { Dot } from "@/ui/Dot";

export function PostByline({ post }: { post: Schemas["PostSummary"] }) {
  const edited = post.updated_at.slice(0, 10) !== post.created_at.slice(0, 10);
  return (
    <span className="text-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:gap-x-2">
      <Link
        href={`/players/${post.author.steamid64}`}
        className="hover:text-accent flex items-center gap-2"
      >
        <Avatar
          name={post.author.name}
          src={avatarSrc(post.author)}
          size="sm"
        />
        {post.author.name}
      </Link>
      <Dot />
      <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
      {edited && (
        <span className="text-text-subtle">
          (edited{" "}
          <time dateTime={post.updated_at}>{formatDate(post.updated_at)}</time>)
        </span>
      )}
    </span>
  );
}
