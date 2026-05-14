import { RouterProvider } from "react-router";
import { router } from "./routes";
import { SimulationProvider } from "./context/SimulationContext";
import { ThemeProvider } from "./context/ThemeContext";
import { DomainProvider } from "./context/DomainContext";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  return (
    <ThemeProvider>
      <DomainProvider>
        <SimulationProvider>
          <RouterProvider router={router} />
          <Toaster />
        </SimulationProvider>
      </DomainProvider>
    </ThemeProvider>
  );
}
