// Community page: posts and videos by players allowed to post, newest first.
import type { Metadata } from "next";
import { PostList } from "@/features/community/PostList";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Community",
  description: "Posts and videos from the SourceJump community.",
};

export default function CommunityPage({
  searchParams,
}: PageProps<"/community">) {
  return (
    <Page className="gap-6" width="narrow">
      <h1 className="text-3xl font-bold">Community</h1>
      {searchParams.then((params) => (
        <PostList
          params={{
            kind: first(params.kind),
            before: first(params.before),
          }}
        />
      ))}
    </Page>
  );
}

/** A repeated query parameter counts by its first value. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
