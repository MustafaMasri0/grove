import { useStore } from "../store";
import { Select } from "../ui";

/** Picks the repository's base branch ("Branch vs base", the Worktrees overview); remembered per repository. */
export function BaseSelect({ labelled = true }: { labelled?: boolean }) {
  const base = useStore((s) => s.base);
  const setBase = useStore((s) => s.setBase);
  const branches = useStore((s) => s.branches);
  const viewBranch = useStore((s) => s.viewBranch);
  const choices = branches.filter((b) => b.fullRef !== viewBranch?.fullRef).map((b) => ({ value: b.name, label: b.name }));
  return (
    <span className="base-select">
      {labelled && <span className="base-l">Base</span>}
      <Select label="Base branch" value={base} options={base && !choices.some((c) => c.value === base) ? [{ value: base, label: base }, ...choices] : choices} onPick={setBase} popWidth={260} />
    </span>
  );
}
