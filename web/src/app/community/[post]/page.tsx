// One community post. The address is `/community/{id}-{slug}`; other forms of it redirect there.
import type { Metadata } from "next";
import { PostView } from "@/features/community/PostView";
import { Page } from "@/ui/Page";

export const metadata: Metadata = { title: "Community" };

export default function PostPage({ params }: PageProps<"/community/[post]">) {
  return (
    <Page width="narrow">
      {params.then(({ post }) => (
        <PostView path={decodeURIComponent(post)} />
      ))}
    </Page>
  );
}
