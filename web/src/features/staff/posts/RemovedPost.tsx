"use client";
// A removed post's page, for staff who hold manage_posts: the post, dimmed, under a note saying who removed it
// and why, with Restore where allowed. Everyone else gets `fallback`, the not-found message.
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { useSignedInPlayer } from "@/features/auth/useSignedInPlayer";
import { PostActions } from "@/features/community/PostActions";
import { BackToCommunity, PostContent } from "@/features/community/PostContent";
import { RemovalNote } from "./RemovalNote";

export function RemovedPost({ fallback }: { fallback: ReactNode }) {
  const me = useSignedInPlayer();
  const allowed = me?.privileges.includes("manage_posts") ?? false;
  // `/community/12-new-map`: the API takes the part after `/community/`, as the page does.
  const path = decodeURIComponent(usePathname().split("/")[2] ?? "");
  const [post, setPost] = useState<Schemas["StaffPost"] | null | undefined>(
    undefined,
  );

  // Next keeps showing this not-found page at the same address even after a refresh, so a restore here, or
  // removing the post again, reads the post anew instead of waiting for the page to change.
  const reload = useCallback(() => {
    void api
      .GET("/v1/staff/posts/{id}", { params: { path: { id: path } } })
      .then((result) => setPost(result.data ?? null))
      .catch(() => setPost(null));
  }, [path]);

  useEffect(() => {
    if (allowed) reload();
  }, [allowed, reload]);

  // Nothing until it's known whether to show the post, so staff don't see "not found" flash first.
  if (me === undefined || (allowed && post === undefined)) return null;
  if (!me || !post) return fallback;

  if (!post.removal) {
    // Restored just now: the post as everyone sees it again.
    return (
      <article className="motion-enter flex flex-col gap-6">
        <BackToCommunity />
        <PostContent post={post} />
        <PostActions post={post} onRemoved={reload} />
      </article>
    );
  }
  return (
    <article className="motion-enter flex flex-col gap-6">
      <BackToCommunity />
      <div className="border-danger/60 bg-danger-soft flex flex-col gap-1 rounded-md border px-4 py-3">
        <p className="text-danger text-sm font-bold">
          Removed. Only staff can see this post.
        </p>
        <RemovalNote
          post={post}
          removal={post.removal}
          me={me}
          onRestored={reload}
        />
      </div>
      <div className="flex flex-col gap-6 opacity-60">
        <PostContent post={post} />
      </div>
    </article>
  );
}
