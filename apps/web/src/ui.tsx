// Parts every screen shares (ui.md section 1, rule 6): a slice shown as a loading skeleton, an
// error with Retry, an empty sentence, or its data; and status chips with text, never colour alone.
import { useRef, useState, type ReactNode } from "react";
import type { Slice } from "./store";

export function SliceView<T>(props: {
  slice: Slice<T>;
  onRetry: () => void;
  /** The empty state: one sentence and the next action. */
  empty: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const { slice } = props;
  if (slice.status === "error" && !slice.data) {
    return (
      <div className="state error" role="alert">
        <p>{slice.error?.reason ?? "Something went wrong."}</p>
        <button type="button" onClick={props.onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (!slice.data) {
    return (
      <div className="state loading" aria-busy="true">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton short" />
      </div>
    );
  }
  const isEmpty = props.isEmpty ?? ((d: T) => Array.isArray(d) && d.length === 0);
  if (isEmpty(slice.data)) return <div className="state empty">{props.empty}</div>;
  return <>{props.children(slice.data)}</>;
}

const TONE: Record<string, string> = {
  approved: "ok",
  confirmed: "ok",
  processed: "ok",
  answered: "ok",
  resolved: "ok",
  waiting: "warn",
  open: "warn",
  pending: "warn",
  stale: "warn",
  rejected: "danger",
  failed: "danger",
  no_text: "danger",
};

export function Chip({ status }: { status: string }) {
  return <span className={`chip ${TONE[status] ?? ""}`}>{status.replace("_", " ")}</span>;
}

export const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * A write on an item at `version`. One click sends one request: the lock holds while the request
 * runs and, after a success, until the gateway's event brings the item's next version (a second
 * request would carry the old version and come back VERSION_OLD). A failed write unlocks.
 */
export function useBusy(
  version: number,
): [boolean, (write: () => Promise<boolean>) => Promise<boolean>] {
  const locked = useRef<number | null>(null);
  const [, render] = useState(0);
  const run = async (write: () => Promise<boolean>) => {
    if (locked.current === version) return false;
    locked.current = version;
    render((n) => n + 1);
    const ok = await write();
    if (!ok) {
      locked.current = null;
      render((n) => n + 1);
    }
    return ok;
  };
  return [locked.current === version, run];
}
