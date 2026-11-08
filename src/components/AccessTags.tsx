// What the file toolbar says about editing a worktree file: that it can be edited and what git makes of a save,
// or, for a file the editable patterns name but Grove cannot edit, why not.
import type { FileAccess } from "../api";
import { Badge } from "../ui";

export function AccessTags({ access }: { access: FileAccess }) {
  if (!access.editable) {
    return access.reason ? (
      <Badge tone="idle" tip={access.reason}>
        Read-only
      </Badge>
    ) : null;
  }
  return (
    <>
      <Badge tone="changes" tip="This file matches your Editable files setting: edit it here and save with Ctrl+S.">
        Editable
      </Badge>
      {access.tracked ? (
        <Badge tone="warn" className="opt-long" tip="Git tracks this file: what you save shows up as a change to commit.">
          In git: changes will be committed
        </Badge>
      ) : (
        <span className="muted opt-long" data-tip="Git does not track this file (it is untracked or ignored), so saving it changes nothing to commit.">
          Not in git
        </span>
      )}
    </>
  );
}
