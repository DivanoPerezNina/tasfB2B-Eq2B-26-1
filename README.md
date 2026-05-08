# TASF.B2B — Sistema de Traslado de Equipajes Extraviados

Sistema de planificación y monitoreo en tiempo real del traslado de maletas extraviadas entre aeropuertos de América, Asia y Europa.

**Proyecto universitario** — PUCP · Ingeniería Informática · 9° ciclo · 2INF54 · 2026-1

---

## Arquitectura

```
[Browser]
    │  HTTP + SSE
    ▼
[Nginx]
    │  archivos estáticos
    ▼
[Frontend — React]
    │  HTTP → puerto 8081
    ▼
[BFF — Go :8081]  ←─ API Gateway, único punto de entrada del frontend
    ├──► [Carga Masiva — Go :8082]    lee .txt → MySQL
    ├──► [Planificador — Java :8080]  GVNS → plan de rutas
    └──► [Ejecutor — Go :8083]        simulación tick a tick + SSE → frontend
              │
              ▼
          [MySQL :3306]  ←─ aeropuertos, planes de vuelo, envíos (datos fríos)
```

### Flujo de la simulación

1. Usuario sube archivos `.txt` desde la pantalla de Configuración
2. **Carga Masiva** ingesta los datos en MySQL (hasta 9.5 M registros)
3. Usuario configura periodo (3 ó 5 días) y velocidad de simulación
4. **BFF** envía parámetros al **Planificador** → GVNS genera el plan completo de rutas
5. **BFF** entrega el plan al **Ejecutor** → Ejecutor avanza la simulación tick a tick
6. **Ejecutor** emite eventos SSE → Frontend actualiza el mapa en tiempo real
7. En cancelación: Ejecutor detecta el bloqueo → avisa al Planificador → nuevo plan → continúa

---

## Componentes

| Componente | Lenguaje | Puerto | Estado |
|---|---|---|---|
| Frontend | React 18 + TypeScript + Vite | — (Nginx) | UI codificada, datos hardcodeados |
| BFF | Go | 8081 | Por implementar |
| Carga Masiva | Go | 8082 | Por implementar |
| Planificador | Java 17 + Spring Boot | 8080 | Algoritmo GVNS completo, falta Spring Boot wrapper |
| Ejecutor | Go | 8083 | Por implementar |
| Base de datos | MySQL | 3306 | Disponible en VM |

---

## Reglas de Negocio

| Parámetro | Mismo continente | Distinto continente |
|---|---|---|
| Plazo máximo de entrega | 1 día | 2 días |
| Tiempo de vuelo | Medio día | 1 día |
| Frecuencia mínima | ≥ 1 vuelo/día | ≥ 1 vuelo/día |
| Capacidad por vuelo | 150 – 250 maletas | 150 – 400 maletas |
| Capacidad almacén | 500 – 800 maletas | 500 – 800 maletas |

- Red: **30 aeropuertos** — América, Europa y Asia (uno por ciudad)
- Cada envío tiene: plan de viaje asignado y monitoreo en tiempo real
- Semaforización en mapa: **verde** (< umbral), **ámbar** (intermedio), **rojo** (> umbral o fuera de plazo)

---

## Simulación de Periodo

- Escenario: **3 ó 5 días simulados**
- Duración real: **30 – 90 minutos**
- Velocidad configurable desde el frontend
- El Planificador usa **GVNS** (General Variable Neighborhood Search) — metaheurístico en Java
- Algoritmo alternativo disponible: **ALNS** (Adaptive Large Neighborhood Search)

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 4, react-simple-maps, Recharts |
| BFF / Carga Masiva / Ejecutor | Go (binarios estáticos Linux — sin runtime en VM) |
| Planificador | Java 17, Spring Boot 4, Maven |
| Servidor web | Nginx (frontend estático) |
| Base de datos | MySQL |

---

## Estructura del Repositorio

```
tasfB2B-Eq2B-26-1/
├── Frontend/                   # React app (Vite + TypeScript)
│   └── src/
│       ├── app/pages/          # SimulationDashboard, SimulationConfig
│       ├── app/components/     # Map, SimulationControls, UI library
│       └── app/context/        # SimulationContext, ThemeContext
├── backend/
│   ├── planificador/           # Java — Motor GVNS/ALNS (ya implementado)
│   │   ├── src/                # Código fuente Java
│   │   ├── datos/              # aeropuertos.txt, vuelos.txt
│   │   └── pom.xml
│   ├── bff/                    # Go — API Gateway (por implementar)
│   ├── carga-masiva/           # Go — Ingesta masiva (por implementar)
│   └── ejecutor/               # Go — Simulación + SSE (por implementar)
├── scripts/
│   ├── start-all.sh            # Levanta todos los servicios en la VM
│   ├── stop-all.sh             # Detiene todos los servicios
│   └── build-all.sh            # Compila todo para Linux desde Windows
└── README.md
```

> **Datos de envíos**: los 30 archivos `_envios_*.txt` (~391 MB en total) no están en el repositorio.
> Compartir por Google Drive del equipo e colocarlos en `backend/planificador/datos/_envios_preliminar_/`.

---

## Desarrollo Local (Windows)

### Requisitos previos
- Node.js 20+ y pnpm
- Java 17+ y Maven 3.9+
- Go 1.22+
- MySQL local

### Arrancar el frontend

```bash
cd Frontend
pnpm install
pnpm dev
# Disponible en http://localhost:5173
```

### Arrancar el Planificador (Java)

```bash
cd backend/planificador
mvn spring-boot:run
# Disponible en http://localhost:8080
```

### Arrancar servicios Go (una vez implementados)

```bash
cd backend/bff
go run ./cmd/bff

cd backend/carga-masiva
go run ./cmd/carga-masiva

cd backend/ejecutor
go run ./cmd/ejecutor
```

---

## Deploy en VM (Ubuntu 24 LTS)

La VM tiene: **Nginx, OpenJDK 17, Node, npm, MySQL**. No tiene Go instalado — los binarios se compilan en la máquina de desarrollo antes del deploy.

### Paso 1 — Compilar en tu máquina (Windows/Mac)

```bash
./scripts/build-all.sh
```

Genera:
- `Frontend/dist/` — archivos estáticos listos para Nginx
- `backend/planificador/target/*.jar` — JAR Spring Boot
- `backend/bff/bin/bff` — binario Linux
- `backend/carga-masiva/bin/carga-masiva` — binario Linux
- `backend/ejecutor/bin/ejecutor` — binario Linux

### Paso 2 — Empaquetar

```bash
zip -r tasfB2B-deploy.zip . \
  -x "*.git*" \
  -x "*/node_modules/*" \
  -x "backend/planificador/datos/_envios_preliminar_/*"
```

### Paso 3 — Deploy en VM

```bash
# Subir el .zip a la VM (scp, FileZilla, etc.)
scp tasfB2B-deploy.zip usuario@ip-vm:/opt/

# En la VM
cd /opt
unzip tasfB2B-deploy.zip -d tasfb2b
cd tasfb2b
chmod +x scripts/*.sh
./scripts/start-all.sh
```

---

## Equipo

| Integrante | GitHub |
|---|---|
| [Nombre 1] | [@usuario] |
| [Nombre 2] | [@usuario] |
| [Nombre 3] | [@usuario] |
| [Nombre 4] | [@usuario] |
