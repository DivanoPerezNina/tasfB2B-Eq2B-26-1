import { PlanResumenVisual, PlanTramoVisual, ShipmentMetadata } from '../types';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

export function planWindow(
  resumen: PlanResumenVisual | null,
  tramos: PlanTramoVisual[],
): { ini: number; fin: number } | null {
  const ini = Number(resumen?.ventanaIniUTC ?? Math.min(...tramos.map((item) => item.registroUTC ?? item.salidaUTC)));
  const fin = Number(resumen?.ventanaFinUTC ?? Math.max(...tramos.map((item) => item.llegadaUTC)) + 1);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return null;
  return { ini, fin };
}

async function unwrap<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.mensaje ?? body.message ?? `Error HTTP ${response.status}`);
  }
  return (body.data ?? body) as T;
}

export async function searchShipmentMetadata(
  query: string,
  window: { ini: number; fin: number },
  signal?: AbortSignal,
  mode: 'periodo' | 'operacion' = 'periodo',
): Promise<ShipmentMetadata[]> {
  const params = new URLSearchParams({
    q: query,
    ini: String(window.ini),
    fin: String(window.fin),
    limit: '20',
    modo: mode,
  });
  const response = await fetch(`${BFF}/api/operaciones/envios/buscar?${params}`, { signal });
  return unwrap<ShipmentMetadata[]>(response);
}

export async function loadShipmentMetadataByIndices(
  indices: number[],
  window: { ini: number; fin: number },
  signal?: AbortSignal,
  mode: 'periodo' | 'operacion' = 'periodo',
): Promise<ShipmentMetadata[]> {
  const unique = Array.from(new Set(indices.filter((value) => Number.isInteger(value) && value >= 0))).slice(0, 250);
  if (unique.length === 0) return [];
  const params = new URLSearchParams({
    indices: unique.join(','),
    ini: String(window.ini),
    fin: String(window.fin),
    modo: mode,
  });
  const response = await fetch(`${BFF}/api/operaciones/envios/por-indices?${params}`, { signal });
  return unwrap<ShipmentMetadata[]>(response);
}

export function shipmentRoutes(planTramos: PlanTramoVisual[]) {
  const result = new Map<number, PlanTramoVisual[]>();
  for (const tramo of planTramos) {
    const route = result.get(tramo.envioIndice) ?? [];
    route.push(tramo);
    result.set(tramo.envioIndice, route);
  }
  for (const route of result.values()) {
    route.sort((a, b) => a.tramoIndex - b.tramoIndex || a.salidaUTC - b.salidaUTC);
  }
  return result;
}

export function shipmentLabel(metadata: ShipmentMetadata | undefined, index: number) {
  return metadata?.id_envio ?? `ENV-${index}`;
}

export function formatUtcMinute(minute: number) {
  const date = new Date(minute * 60 * 1000);
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
}
