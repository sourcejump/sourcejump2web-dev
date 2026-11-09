"use client";
// The box a signed-in player comments in: at the top of a run's comments, or under one to reply. The API
// checks every rule again: the length, the wait between comments, and bans from posting.
import { type FormEvent, useState } from "react";
import { api, failureMessage, type Schemas } from "@/api/client";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Textarea } from "@/ui/Textarea";
import { avatarSrc } from "@/features/players/avatarSrc";

const MAX_CHARS = 1000;

export function CommentForm({
  run,
  me,
  replyTo,
  onPosted,
  onCancel,
}: {
  run: number;
  me: Schemas["Me"];
  /** The top-level comment this answers; none for a new comment. */
  replyTo?: number;
  onPosted: (comment: Schemas["RunComment"]) => void;
  /** For a reply box, which closes. */
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = body.trim().length;

  async function post(event: FormEvent) {
    event.preventDefault();
    if (length === 0) {
      setError("Write something first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api
      .POST("/v1/runs/{id}/comments", {
        params: { path: { id: run } },
        body: { body, reply_to: replyTo },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      setBody("");
      onPosted(result.data);
    } else {
      setError(
        failureMessage(
          result?.error,
          "Your comment couldn't be posted. Try again.",
        ),
      );
    }
  }

  return (
    <form onSubmit={post} className="flex gap-3">
      <Avatar name={me.name} src={avatarSrc(me)} size={replyTo ? "sm" : "md"} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
          maxLength={MAX_CHARS}
          rows={2}
          placeholder={
            replyTo ? "Write a reply" : "Say something about this run"
          }
          aria-label={replyTo ? "Your reply" : "Your comment"}
          autoFocus={replyTo !== undefined}
          size="sm"
        />
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-subtle text-xs tabular-nums">
            {length} / {MAX_CHARS}
          </span>
          <div className="flex gap-2">
            {onCancel && (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button type="submit" size="sm" variant="primary" disabled={busy}>
              {busy ? "Posting…" : replyTo ? "Reply" : "Post comment"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
