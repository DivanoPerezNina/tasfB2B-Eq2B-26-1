import { useState } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { SimulationProvider } from "./context/SimulationContext";
import { ThemeProvider } from "./context/ThemeContext";
import { DomainProvider } from "./context/DomainContext";
import { Toaster } from "./components/ui/sonner";
import { Login } from "./pages/Login";
import { isAuthed } from "./lib/auth";

export default function App() {
  const [authed, setAuthed] = useState(isAuthed());

  return (
    <ThemeProvider>
      {authed ? (
        <DomainProvider>
          <SimulationProvider>
            <RouterProvider router={router} />
            <Toaster />
          </SimulationProvider>
        </DomainProvider>
      ) : (
        <Login onSuccess={() => setAuthed(true)} />
      )}
    </ThemeProvider>
  );
}
