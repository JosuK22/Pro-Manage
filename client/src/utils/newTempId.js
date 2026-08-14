/**
 * A throwaway id for a checklist row that has not been saved yet.
 *
 * These only ever live in client state: they give React a stable `key` while
 * the user is typing, and are stripped before the task is sent (the server
 * assigns the real ids). That made a whole `uuid` dependency hard to justify —
 * `crypto.randomUUID` is built into every browser the app supports.
 *
 * The fallback covers non-secure contexts, where `crypto.randomUUID` is not
 * exposed. Uniqueness within one open form is all that is required here; this
 * is never used for anything security-sensitive.
 */
export default function newTempId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
