# Frontend — Dashboard Logística Aeroportuaria

**Framework:** React + TypeScript + Vite  
**Puerto de desarrollo:** 5173  
**Estado:** ✅ Conectado al BFF (http://localhost:8081)

---

## Instalación y ejecución

```bash
cd Frontend
npm install
npm run dev
```

Abrir en el navegador: http://localhost:5173

> **Requisito:** el BFF debe estar corriendo en `:8081` antes de usar la simulación.

---

## Arquitectura

```
src/app/
├── context/
│   └── SimulationContext.tsx   ← Estado global + llamadas al BFF
├── pages/
│   ├── SimulationConfig.tsx    ← Configurar y lanzar simulaciones
│   ├── Dashboard.tsx           ← Vista general
│   ├── Monitoring.tsx          ← Monitoreo en tiempo real
│   └── ...
├── components/
│   ├── Map.tsx                 ← Mapa mundial con aeropuertos
│   ├── SimulationControls.tsx  ← Barra de controles
│   └── ...
└── types/index.ts              ← Tipos compartidos
```

---

## Flujo de Simulación de Periodo

```
1. SimulationConfig.tsx
   └─ Usuario elige: fechaInicio, días (3/5/7), duración (30-90 min), criterio

2. POST http://localhost:8081/api/planificacion/iniciar
   └─ El contexto hace polling cada 2 seg a /api/planificacion/status/{jobId}
   └─ Barra de progreso muestra warm-up → GVNS → 100%

3. POST http://localhost:8081/api/simulacion/iniciar
   └─ body: { job_id, duracion_real_min, umbrales }

4. SSE: EventSource http://localhost:8081/api/simulacion/eventos
   └─ evento "tick"       → actualiza tiempo simulado, progreso, contadores
   └─ evento "aeropuertos" → actualiza semáforos en el mapa
   └─ evento "completado"  → finaliza simulación
```

---

## Velocidad calculada automáticamente

El usuario no configura "velocidad × real" — elige **duración** (min reales):

| Días | 30 min | 45 min | 60 min | 90 min |
|------|--------|--------|--------|--------|
| 3    | 2.4×   | 1.6×   | 1.2×   | 0.8×   |
| 5    | 4.0×   | 2.67×  | 2.0×   | 1.33×  |
| 7    | 5.6×   | 3.73×  | 2.8×   | 1.87×  |

---

## Variables de entorno

La URL del BFF está definida como constante en `SimulationContext.tsx`:

```typescript
const BFF = 'http://localhost:8081';
```

Para producción, usar una variable de entorno Vite:
```typescript
const BFF = import.meta.env.VITE_BFF_URL ?? 'http://localhost:8081';
```

---

## Dataset disponible

El dataset cargado en MySQL cubre:
- **Fechas:** 2026-01-02 → 2029-01-05
- **Envíos:** 9,519,995 registros
- **Aeropuertos:** 30 (visibles en GET /api/aeropuertos)

La página de configuración muestra este rango automáticamente desde `/api/dataset`.

---

## TODOs pendientes

- [ ] Cancelaciones de vuelo (UI para reportar cancelación mid-simulation)
- [ ] Escenario Colapso (criterio de parada automático)
- [ ] Persistir historial de simulaciones en LocalStorage
- [ ] Variable de entorno `VITE_BFF_URL` para despliegue en producción
