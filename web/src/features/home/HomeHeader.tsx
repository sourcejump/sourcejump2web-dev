import { ArrowUpRight } from "lucide-react";
import { Dot } from "@/ui/Dot";
import { formatDate } from "@/features/runs/time";
import { latestUpload, youtubeChannel } from "./latestUpload";
import { UploadPlayer } from "./UploadPlayer";

const views = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export async function HomeHeader() {
  const upload = await latestUpload();
  const hasRun = upload?.map && upload.player && upload.time;

  return (
    <section
      aria-labelledby="latest-upload-heading"
      className="flex flex-col gap-3"
    >
      <h1 className="sr-only">SourceJump</h1>
      <div className="flex items-center justify-between gap-4">
        <h2 id="latest-upload-heading" className="text-lg font-bold">
          Latest upload
        </h2>
        <a
          href={youtubeChannel}
          target="_blank"
          rel="noreferrer"
          className="text-text-muted hover:text-accent inline-flex items-center gap-1 text-sm transition-colors"
        >
          Open channel <ArrowUpRight aria-hidden className="size-4" />
        </a>
      </div>
      {upload ? (
        <div className="border-border bg-surface grid overflow-hidden rounded-md border md:grid-cols-5">
          <UploadPlayer
            key={upload.id}
            id={upload.id}
            title={upload.title}
            thumbnail={upload.thumbnail}
          />
          <div className="flex min-w-0 flex-col justify-center gap-5 p-5 sm:p-7 md:col-span-2">
            <div className="flex flex-col gap-4">
              <h3 className="text-xl font-bold wrap-anywhere sm:text-2xl">
                {hasRun ? upload.title.split(/\s+in\s+\d/)[0] : upload.title}
              </h3>
              {hasRun && (
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    aria-label={`Run time ${upload.time}`}
                    className="text-accent text-2xl font-bold tabular-nums"
                  >
                    {upload.time}
                  </span>
                  <span className="text-text-muted text-sm">
                    by <span className="text-text">{upload.player}</span>
                  </span>
                </p>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <p className="text-text-subtle flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {upload.views !== undefined && (
                  <>
                    <span>{views.format(upload.views)} views</span>
                    <Dot />
                  </>
                )}
                <time
                  dateTime={upload.publishedAt}
                  title={formatDate(upload.publishedAt)}
                >
                  {upload.age}
                </time>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="border-border bg-surface text-text-muted rounded-md border p-6 text-sm">
          The latest upload couldn&apos;t be loaded. You can still watch it on
          the channel.
        </p>
      )}
    </section>
  );
}
