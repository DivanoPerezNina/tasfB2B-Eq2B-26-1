import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { UnifiedDashboard } from './pages/UnifiedDashboard';
import { SimulationConfig } from './pages/SimulationConfig';
import { DataIngestion } from './pages/DataIngestion';
import { Contingencies } from './pages/Contingencies';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <UnifiedDashboard /> },
      { path: 'configuracion', element: <SimulationConfig /> },
      { path: 'cancelaciones', element: <Contingencies /> },
      { path: 'datos', element: <DataIngestion /> },
    ],
  },
]);