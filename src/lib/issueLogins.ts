// The logins a repository's account setting can pick from, for Settings.

import { api, type IssueLogins, type TrackerInfo } from "../api";

/** A repository's tracker and the logins there are for it. */
export interface RepoLogins {
  tracker: TrackerInfo;
  logins: IssueLogins;
}

/**
 * Reads the logins for a repository; null when it has no tracker. Each tracker's logins
 * are read once per reader, however many repositories use that tracker, since reading
 * them can take a moment.
 */
export function loginReader(): (at: { repo: string; cwd: string }) => Promise<RepoLogins | null> {
  const byTracker = new Map<string, Promise<IssueLogins>>();
  return async (at) => {
    try {
      const tracker = await api.issueTracker(at);
      let logins = byTracker.get(tracker.name);
      if (!logins) {
        byTracker.set(tracker.name, (logins = api.issueLogins(at)));
        // A failed read is tried again by the next repository, not kept for all of them.
        logins.catch(() => byTracker.delete(tracker.name));
      }
      return { tracker, logins: await logins };
    } catch {
      return null;
    }
  };
}
