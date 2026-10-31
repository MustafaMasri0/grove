// The design system's dev-only page, outside the production build: `pnpm exec vite` then /harness/.
// ?theme=dark|light picks the theme and ?font=10..18 the UI font size. scripts/ui-check.mjs drives it headless.
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import "../src/ui";
import "./gallery.css";
import { useStore } from "../src/store";
import { Gallery } from "./Gallery";
import { respond } from "./mockIpc";

clearMocks();
mockWindows("main");
mockIPC(respond);

const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme = theme;
document.documentElement.style.setProperty("--ui-font-size", `${Number(query.get("font")) || 13}px`);
useStore.setState((s) => ({ settings: { ...s.settings, theme } }));

createRoot(document.getElementById("root")!).render(<Gallery />);
