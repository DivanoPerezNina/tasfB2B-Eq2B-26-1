
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  // IBM Plex (Carbon) — pesos usados por los tokens de tipografía.
  import "@fontsource/ibm-plex-sans/300.css";
  import "@fontsource/ibm-plex-sans/400.css";
  import "@fontsource/ibm-plex-sans/600.css";
  import "@fontsource/ibm-plex-mono/400.css";
  // Carbon primero; Tailwind/tema actual después (gana en pantallas aún no migradas).
  import "./styles/carbon.scss";
  import "./styles/index.css";

  createRoot(document.getElementById("root")!).render(<App />);
  