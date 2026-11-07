"use client";
// One top-level comment on a run with its replies under it: the first 3 as the list read them, then Show more
// replies for the rest, and a reply box opened by Reply. A removed comment that still has replies shows as a
// placeholder. The run's player pins and unpins from here.
import { MessageSquare, Pin, PinOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api, failureMessage, type Schemas } from "@/api/client";
import { RestoreComment } from "@/features/staff/runs/RestoreComment";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Tooltip } from "@/ui/Tooltip";
import { CommentForm } from "./CommentForm";
import { RemoveComment } from "./RemoveComment";
import { formatDateTime, formatSince } from "./time";
import { avatarSrc } from "@/features/players/avatarSrc";

type Comment = Schemas["RunComment"];

/** Who's reading, which decides the buttons each comment shows. The API checks every change again. */
export type Viewer = {
  me: Schemas["Me"] | null;
  /** Holds manage_posts: reads removed comments and removes anyone's. */
  asStaff: boolean;
  /** The run's player, who pins. */
  isRunner: boolean;
};

function readReplies(
  run: number,
  comment: number,
  asStaff: boolean,
  cursor: string,
) {
  const params = { path: { id: run, comment }, query: { cursor } };
  return asStaff
    ? api.GET("/v1/staff/runs/{id}/comments/{comment}/replies", { params })
    : api.GET("/v1/runs/{id}/comments/{comment}/replies", { params });
}

export function CommentThread({
  run,
  runner,
  thread,
  pinned,
  viewer,
  onChanged,
  onReplied,
}: {
  run: number;
  runner: Schemas["PlayerRef"];
  thread: Schemas["RunCommentThread"];
  pinned: boolean;
  viewer: Viewer;
  /** After a change that moves the list: a new pin, a removal or restore. */
  onChanged: () => void;
  /** After the viewer replies; the reply is shown here. */
  onReplied: () => void;
}) {
  // Replies read with Show more, and the viewer's own posted since the list was read.
  const [more, setMore] = useState<Comment[]>([]);
  const [added, setAdded] = useState<Comment[]>([]);
  const [replying, setReplying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const read = [...thread.replies, ...more];
  // A reply of the viewer's can come back again with Show more; it shows once.
  const readIds = new Set(read.map((reply) => reply.id));
  const replies = [...read, ...added.filter((reply) => !readIds.has(reply.id))];
  const remaining = thread.reply_count + added.length - replies.length;
  const comment = thread.comment;
  const canReply = Boolean(viewer.me && comment && !comment.removal);

  async function showMoreReplies() {
    const last = read.at(-1);
    if (!last) return;
    setLoading(true);
    setFailed(false);
    const result = await readReplies(
      run,
      thread.id,
      viewer.asStaff,
      String(last.id),
    ).catch(() => undefined);
    setLoading(false);
    const page = result?.data;
    if (page) setMore((current) => [...current, ...page.replies]);
    else setFailed(true);
  }

  return (
    <li className="motion-enter flex flex-col gap-3 py-3">
      {pinned && (
        <p className="text-text-subtle -mb-1 flex items-center gap-1.5 text-xs">
          <Pin aria-hidden className="size-3.5" />
          Pinned by {runner.name}
        </p>
      )}
      {comment ? (
        <CommentRow
          run={run}
          comment={comment}
          viewer={viewer}
          onChanged={onChanged}
          actions={
            <>
              {canReply && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReplying(true)}
                >
                  <MessageSquare aria-hidden />
                  Reply
                </Button>
              )}
              {viewer.isRunner && !comment.removal && (
                <PinButton
                  run={run}
                  comment={comment.id}
                  pinned={pinned}
                  onChanged={onChanged}
                />
              )}
            </>
          }
        />
      ) : (
        <p className="text-text-muted py-1 pl-11 text-sm">
          This comment was removed.
        </p>
      )}
      {(replies.length > 0 || replying || remaining > 0) && (
        <div className="flex flex-col gap-3 pl-11">
          {replies.map((reply) => (
            <CommentRow
              key={reply.id}
              run={run}
              comment={reply}
              viewer={viewer}
              onChanged={onChanged}
              small
            />
          ))}
          {failed && (
            <p className="text-danger text-sm">
              More replies couldn&apos;t be loaded. Try again.
            </p>
          )}
          {remaining > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={showMoreReplies}
              disabled={loading}
            >
              {loading
                ? "Loading…"
                : `Show ${remaining} more ${remaining === 1 ? "reply" : "replies"}`}
            </Button>
          )}
          {replying && viewer.me && (
            <div className="motion-enter">
              <CommentForm
                run={run}
                me={viewer.me}
                replyTo={thread.id}
                onPosted={(reply) => {
                  setAdded((current) => [...current, reply]);
                  setReplying(false);
                  onReplied();
                }}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** One comment or reply: who and when, its buttons, and its text. */
function CommentRow({
  run,
  comment,
  viewer,
  onChanged,
  actions,
  small = false,
}: {
  run: number;
  comment: Comment;
  viewer: Viewer;
  onChanged: () => void;
  /** Buttons only a top-level comment has. */
  actions?: ReactNode;
  /** A reply, set a little smaller under its comment. */
  small?: boolean;
}) {
  const { author, removal } = comment;
  const mine = author.steamid64 === viewer.me?.steamid64;
  return (
    <div className="flex gap-3">
      {/* A removed comment is dimmed, but not its Restore button. */}
      <Link
        href={`/players/${author.steamid64}`}
        className={classNames("shrink-0", removal && "opacity-50")}
      >
        <Avatar
          name={author.name}
          src={avatarSrc(author)}
          size={small ? "sm" : "md"}
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Link
            href={`/players/${author.steamid64}`}
            className="hover:text-accent inline-flex items-center gap-1.5 font-medium"
          >
            {author.name}
            <Flag code={author.country_code} />
          </Link>
          <Tooltip content={formatDateTime(comment.created_at)}>
            <time
              dateTime={comment.created_at}
              tabIndex={0}
              className="text-text-subtle rounded-sm text-sm"
            >
              {formatSince(comment.created_at)}
            </time>
          </Tooltip>
          {removal && <RemovalNote removal={removal} />}
        </div>
        <p
          className={classNames(
            "text-sm leading-relaxed break-words whitespace-pre-line",
            removal && "opacity-50",
          )}
        >
          {comment.body}
        </p>
        <div className="-ml-3 flex flex-wrap gap-1 empty:hidden">
          {!removal && actions}
          {!removal && (mine || viewer.asStaff) && (
            <RemoveComment
              run={run}
              id={comment.id}
              asStaff={!mine}
              onRemoved={onChanged}
            />
          )}
          {removal && viewer.asStaff && !removal.by_author && !mine && (
            <RestoreComment id={comment.id} onRestored={onChanged} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Staff see who removed a comment and why. */
function RemovalNote({ removal }: { removal: Schemas["Removal"] }) {
  const by = removal.by_author
    ? "removed by its author"
    : `removed by ${removal.hidden_by?.name ?? "staff"}`;
  return (
    <span className="text-text-subtle text-sm">
      · {by}
      {removal.reason && <>: &ldquo;{removal.reason}&rdquo;</>}
    </span>
  );
}

/** Pins this comment above the others, replacing any pinned before, or unpins it. */
function PinButton({
  run,
  comment,
  pinned,
  onChanged,
}: {
  run: number;
  comment: number;
  pinned: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const result = await api
      .PUT("/v1/runs/{id}/pinned-comment", {
        params: { path: { id: run } },
        body: { comment: pinned ? null : comment },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.response.ok) onChanged();
    else
      setError(
        failureMessage(
          result?.error,
          pinned
            ? "The comment couldn't be unpinned. Try again."
            : "The comment couldn't be pinned. Try again.",
        ),
      );
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={toggle} disabled={busy}>
        {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {pinned ? "Unpin" : "Pin"}
      </Button>
      {error && <p className="text-danger self-center text-sm">{error}</p>}
    </>
  );
}
