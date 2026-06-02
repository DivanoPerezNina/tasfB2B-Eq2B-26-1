import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { UnifiedDashboard } from './pages/UnifiedDashboard';
import { SimulationConfig } from './pages/SimulationConfig';
import { DataIngestion } from './pages/DataIngestion';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <UnifiedDashboard /> },
      { path: 'configuracion', element: <SimulationConfig /> },
      { path: 'datos', element: <DataIngestion /> },
    ],
  },
]);