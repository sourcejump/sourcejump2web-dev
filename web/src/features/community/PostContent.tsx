// A post's title, author, video link and text, as its page shows them: for everyone on a published post's
// page, and for staff on a removed one.
import { ArrowLeft } from "lucide-react";
import type { Schemas } from "@/api/client";
import { Badge } from "@/ui/Badge";
import { Link } from "@/ui/Link";
import { Prose } from "@/ui/Prose";
import { PostByline } from "./PostByline";
import { WatchOnYouTube } from "./WatchOnYouTube";

export function PostContent({ post }: { post: Schemas["Post"] }) {
  return (
    <>
      <header className="flex flex-col gap-3">
        {post.kind === "video" && (
          <Badge tone="accent" className="self-start">
            Video
          </Badge>
        )}
        <h1 className="text-3xl font-bold">{post.title}</h1>
        <PostByline post={post} />
      </header>
      {post.video_url && (
        <div>
          <WatchOnYouTube href={post.video_url} />
        </div>
      )}
      {post.body_html && <Prose html={post.body_html} />}
    </>
  );
}

export function BackToCommunity() {
  return (
    <Link
      href="/community"
      className="text-text-muted hover:text-accent flex items-center gap-1 self-start text-sm"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      Community
    </Link>
  );
}
