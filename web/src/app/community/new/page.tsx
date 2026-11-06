// Writing a new community post, for players allowed to post.
import type { Metadata } from "next";
import { WritePost } from "@/features/community/WritePost";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "New post",
  robots: { index: false },
};

export default function NewPostPage() {
  return (
    <Page className="gap-6" width="narrow">
      <h1 className="text-3xl font-bold">New post</h1>
      <WritePost />
    </Page>
  );
}
