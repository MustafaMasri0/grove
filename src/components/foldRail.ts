// Folding the rail: the page slides and the rail's contents blur-crossfade. The layout changes once, then the
// page starts at its old place and slides home on a transform, so nothing reflows frame by frame. A copy of the
// old rail fades out over the new one, under the page; it lives in a host React renders empty and never touches.
import { flushSync } from "react-dom";
import { useStore } from "../store";

const MS = 220;
let timer = 0;

export function foldRail() {
  const rail = document.getElementById("rail");
  const main = document.getElementById("main");
  const host = document.getElementById("rail-fold");
  const collapsed = !useStore.getState().settings.railCollapsed;
  const commit = () => flushSync(() => useStore.getState().updateSettings({ railCollapsed: collapsed }));
  if (!rail || !main || !host) return commit();

  const settle = () => {
    window.clearTimeout(timer);
    host.replaceChildren();
    delete rail.dataset.fold;
    delete main.dataset.fold;
  };
  settle();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return commit();

  const from = rail.offsetWidth;
  const scroll = rail.querySelector(".rail-list")?.scrollTop ?? 0;
  const ghost = rail.cloneNode(true) as HTMLElement;
  const typed = rail.querySelector("input")?.value;
  const field = ghost.querySelector("input");
  if (field && typed !== undefined) field.value = typed;
  ghost.querySelectorAll("[id],[data-tip],[tabindex]").forEach((e) => ["id", "data-tip", "tabindex"].forEach((n) => e.removeAttribute(n)));
  ghost.removeAttribute("id");
  ghost.classList.add("rail-ghost");
  ghost.style.width = `${from}px`;

  commit();

  host.append(ghost);
  const copy = ghost.querySelector(".rail-list");
  if (copy) copy.scrollTop = scroll;
  const x = from - rail.offsetWidth;
  main.style.setProperty("--fold-x", `${x}px`);
  main.style.setProperty("--fold-gap", `${Math.max(0, -x)}px`);
  void rail.offsetWidth;
  rail.dataset.fold = "";
  main.dataset.fold = "";
  timer = window.setTimeout(settle, MS);
}
