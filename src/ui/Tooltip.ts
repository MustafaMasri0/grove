// Tooltip: gives [data-tip] its behaviour. One element, after a short wait; moving between controls shows the next at once. Keyboard focus shows it too.
import { placeAt } from "./Overlay";

const WAIT_MS = 500;
const WARM_MS = 400;

const tipTarget = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;

/** Starts tooltips, drawn into `host`. Returns what stops them. */
export function watchTooltips(host: HTMLElement) {
  let timer = 0;
  let tip: HTMLElement | null = null;
  let warmUntil = 0;

  const hide = () => {
    window.clearTimeout(timer);
    tip?.remove();
    tip = null;
  };
  const show = (t: HTMLElement) => {
    const text = t.dataset.tip;
    hide();
    if (!text) return;
    tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    host.append(tip);
    const r = t.getBoundingClientRect();
    placeAt(tip, r.left, r.bottom + 6, r.top - 6, r.right);
  };

  const over = (e: MouseEvent) => {
    const t = tipTarget(e.target);
    if (!t) return hide();
    if (tip) return show(t);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => show(t), Date.now() < warmUntil ? 0 : WAIT_MS);
  };
  const out = (e: MouseEvent) => {
    if (!tipTarget(e.target) || tipTarget(e.relatedTarget)) return;
    if (tip) warmUntil = Date.now() + WARM_MS;
    hide();
  };
  const focusIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t.matches?.("[data-tip]:focus-visible")) show(t);
  };

  document.addEventListener("mouseover", over);
  document.addEventListener("mouseout", out);
  document.addEventListener("focusin", focusIn);
  document.addEventListener("focusout", hide);
  document.addEventListener("mousedown", hide, true);
  return () => {
    hide();
    document.removeEventListener("mouseover", over);
    document.removeEventListener("mouseout", out);
    document.removeEventListener("focusin", focusIn);
    document.removeEventListener("focusout", hide);
    document.removeEventListener("mousedown", hide, true);
  };
}
