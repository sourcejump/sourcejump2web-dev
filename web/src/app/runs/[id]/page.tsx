// A run's own page, for links opened directly and from the run dialog: the replay, the run's details, and
// staff act on the run here.
// Following a run link within the site opens the run dialog instead.
import type { Metadata } from "next";
import { currentStyles } from "@/features/ruleset/styles";
import { getRun, RunDetails } from "@/features/runs/RunDetails";
import { runPreview } from "@/features/runs/runPreview";
import { Page } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/runs/[id]">): Promise<Metadata> {
  const [run, styles] = await Promise.all([
    getRun((await params).id),
    currentStyles(),
  ]);
  return run ? runPreview(run, styles.name) : { title: "Run" };
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
