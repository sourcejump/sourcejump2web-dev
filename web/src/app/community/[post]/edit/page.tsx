// Editing a community post, for its author and staff.
import type { Metadata } from "next";
import { WritePost } from "@/features/community/WritePost";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Edit post",
  robots: { index: false },
};

export default function EditPostPage({
  params,
}: PageProps<"/community/[post]/edit">) {
  return (
    <Page className="gap-6" width="narrow">
      <h1 className="text-3xl font-bold">Edit post</h1>
      {params.then(({ post }) => (
        <WritePost path={decodeURIComponent(post)} />
      ))}
    </Page>
  );
}
