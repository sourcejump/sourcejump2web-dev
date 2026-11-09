"use client";

import { Play } from "lucide-react";
import { useState } from "react";

export function UploadPlayer({
  id,
  title,
  thumbnail,
}: {
  id: string;
  title: string;
  thumbnail: string;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="bg-bg relative aspect-video overflow-hidden md:col-span-3">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&controls=1&playsinline=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={(event) => event.currentTarget.focus()}
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play ${title}`}
          className="group focus-visible:outline-accent absolute inset-0 flex size-full items-center justify-center focus-visible:-outline-offset-4"
        >
          {/* The player loads only when requested; the homepage starts with just its thumbnail. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnail}
            alt=""
            width={1280}
            height={720}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
          <span className="bg-accent text-on-accent group-hover:bg-accent-hover relative inline-flex size-16 items-center justify-center rounded-full transition-colors">
            <Play aria-hidden className="size-7 fill-current" />
          </span>
        </button>
      )}
    </div>
  );
}
