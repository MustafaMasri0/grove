import { createRoot } from "react-dom/client";
import "./monaco";
import { App } from "./App";
import "./styles.css";
import "./ui";

createRoot(document.getElementById("root")!).render(<App />);
void import("./themeLab");
