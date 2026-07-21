import { useState } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { SimulationProvider } from "./context/SimulationContext";
import { ThemeProvider } from "./context/ThemeContext";
import { DomainProvider } from "./context/DomainContext";
import { Toaster } from "./components/ui/sonner";
import { Login } from "./pages/Login";
import { OperarioDashboard } from "./pages/OperarioDashboard";
import { getPerfil, Perfil } from "./lib/auth";

export default function App() {
  const [perfil, setPerfil] = useState<Perfil | null>(getPerfil());

  return (
    <ThemeProvider>
      {!perfil ? (
        <Login onSuccess={setPerfil} />
      ) : perfil.rol === "operario" ? (
        // El operario necesita Domain+Simulation para el mapa en vivo (se
        // suscribe como espectador al SSE; no controla la simulación).
        // El Toaster también va aquí: sin él, los toast del dashboard no se ven.
        <DomainProvider>
          <SimulationProvider>
            <OperarioDashboard perfil={perfil} onLogout={() => setPerfil(null)} />
            <Toaster />
          </SimulationProvider>
        </DomainProvider>
      ) : (
        <DomainProvider>
          <SimulationProvider>
            <RouterProvider router={router} />
            <Toaster />
          </SimulationProvider>
        </DomainProvider>
      )}
    </ThemeProvider>
  );
}
