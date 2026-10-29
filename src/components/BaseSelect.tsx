import { useStore } from "../store";

/** Picks the repository's base branch ("Branch vs base", the Worktrees overview); remembered per repository. */
export function BaseSelect() {
  const base = useStore((s) => s.base);
  const setBase = useStore((s) => s.setBase);
  const branches = useStore((s) => s.branches);
  const viewBranch = useStore((s) => s.viewBranch);
  const choices = branches.filter((b) => b.fullRef !== viewBranch?.fullRef);
  return (
    <label className="base-select">
      Base
      <select value={base ?? ""} onChange={(e) => setBase(e.target.value)}>
        {!base && <option value="">—</option>}
        {base && !choices.some((b) => b.name === base) && <option value={base}>{base}</option>}
        {choices.map((b) => (
          <option key={b.fullRef} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
