import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { UnifiedDashboard } from './pages/UnifiedDashboard';
import { SimulationConfig } from './pages/SimulationConfig';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <UnifiedDashboard /> },
      { path: 'configuracion', element: <SimulationConfig /> },
    ],
  },
]);