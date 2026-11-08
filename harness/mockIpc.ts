// The backend as the harness sees it: no real command runs, and everything it answers is made up.
const FILES = [
  { path: "src/server/api/orders/create.ts", kind: "modified" },
  { path: "src/client/components/checkout/postal.ts", kind: "added" },
  { path: "src/server/api/users/logout.ts", kind: "deleted" },
] as const;

export const SAMPLE_FILES = FILES;

export function respond(command: string): unknown {
  switch (command) {
    case "avatar":
      return null; // No picture: the author's initials show.
    case "load_settings":
      return {};
    case "file_access":
      return { editable: false, reason: null, tracked: true }; // Read-only, as most files are.
    default:
      throw new Error(`The harness has no answer for ${command}`);
  }
}
