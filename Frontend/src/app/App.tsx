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
        <OperarioDashboard perfil={perfil} onLogout={() => setPerfil(null)} />
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
