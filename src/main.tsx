import { createRoot } from "react-dom/client";
import "./monaco";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
