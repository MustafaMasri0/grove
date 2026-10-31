// The real App on mocked IPC: everything it reads is made up, nothing runs git, and no window of its own opens.
// ?auto=<JSON> answers the `automation` command, so the WV_* hooks run as they do in a test instance. Commands are logged to window.__ipc.
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { respondApp } from "./mockApp";

clearMocks();
mockWindows("main");
mockIPC(respondApp, { shouldMockEvents: true });

// App and Monaco come after the mocks, as the page's first invoke must find them.
await import("../src/monaco");
const { App } = await import("../src/App");
const { useStore } = await import("../src/store");
(window as unknown as { __store: typeof useStore }).__store = useStore;
await import("../src/styles.css");
await import("../src/ui");

createRoot(document.getElementById("root")!).render(<App />);
