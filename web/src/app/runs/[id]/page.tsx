// A run's own page, for links opened directly and from the run dialog: the replay, the run's details, and
// staff act on the run here.
// Following a run link within the site opens the run dialog instead.
import type { Metadata } from "next";
import { getRun, RunDetails } from "@/features/runs/RunDetails";
import { Page } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/runs/[id]">): Promise<Metadata> {
  const run = await getRun((await params).id);
  return { title: run ? `${run.player.name} on ${run.map}` : "Run" };
}

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <Page className="gap-6">
      {params.then(({ id }) => (
        <RunDetails id={id} />
      ))}
    </Page>
  );
}
