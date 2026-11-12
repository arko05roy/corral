import "@fontsource/im-fell-english-sc";
import "@fontsource/schibsted-grotesk/400.css";
import "@fontsource/schibsted-grotesk/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
