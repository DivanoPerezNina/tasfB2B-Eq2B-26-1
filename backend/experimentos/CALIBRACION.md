# Calibración de la planificación programada — Ta, Sa, Sc, K

Resultados medidos con el dataset real (3 años, 9.5 M envíos) y cómo elegir los
valores para cada escenario. Todo se obtiene **por experimentación** con el
[módulo de pruebas](README.md), no se inventa.

---

## 1. Las cuatro variables

| Símbolo | Qué es | Unidad | Cómo se obtiene |
|---|---|---|---|
| **Ta** | Tiempo que tarda **una ejecución** del planificador (GVNS) | segundos reales | se **mide** |
| **Sa** | "Salto del algoritmo": intervalo real **entre** ejecuciones | segundos reales | se **fija** |
| **Sc** | "Salto del consumo": cuántos minutos de **datos** consume cada ejecución | minutos de pedido | se **deriva** |
| **K** | Factor de aceleración del tiempo | min-dato / min-real | se **deriva** |

### Fórmulas que las relacionan

```
K  = Sc / Sa                      (cuántos min de datos avanzan por min real)
duración_real = datos_totales / K (cuánto dura la simulación en la pantalla)
nº de bloques = datos_totales / Sc = duración_real / Sa
```

### Las dos reglas de oro

1. **Estabilidad:** `Ta < Sa` **siempre**. Si una ejecución tarda más que el
   intervalo, la siguiente arranca antes de terminar la anterior → **cae la
   solución**. (Esto es el "colapso técnico".)
2. **Rango de duración (Sim de periodo):** la simulación debe durar **30–90 min**
   reales. Eso fija `K` (y por tanto `Sc`).

> **No hay un valor exacto.** Si `Sa`/`Sc` son **muy grandes** → la simulación no
> cabe en 30–90 min y/o el colapso llega muy pronto. Si son **muy pequeños** →
> `Ta > Sa` y la solución cae. Se busca el punto cómodo en medio.

---

## 2. Modelo de consumo: ACUMULATIVO

Cada ejecución re-planifica **todo desde t=0** hasta el horizonte actual
(`t0 → t0+Sc → t0+2·Sc → …`). Por eso **`Ta` crece** con cada bloque: el último
es el más pesado. La estabilidad la fija el **último bloque** (`Sa > Ta_último`).

```
t=0 = fecha/hora elegida (solo datos del futuro)
bloque 1:  planifica [t0, t0+Sc)
bloque 2:  planifica [t0, t0+2·Sc)   ← más datos → más Ta
bloque n:  planifica [t0, t0+n·Sc)
```

---

## 3. Resultados medidos

### 3.1 Curva de `Ta` vs volumen (barrido de colapso, EDF, t0 = 2026-01-02)

| Horizonte | Fecha fin | Envíos | Ta | Rechazos |
|---|---|---|---|---|
| 60 d | 2026-03-03 | 45 241 | 3.8 s | 0 |
| 120 d | 2026-05-02 | 130 754 | 4.5 s | 0 |
| 180 d | 2026-07-01 | 262 045 | 5.7 s | 0 |
| 240 d | 2026-08-30 | 444 437 | 11.3 s | 0 |
| 270 d | 2026-09-29 | 558 529 | 21.8 s | 0 |
| 360 d | 2026-12-28 | 966 260 | 27.7 s | 0 |
| **450 d** | 2027-03-28 | **1 501 889** | **124.9 s** | 0 |
| 540 d | — | ~1.8 M | **OOM (HTTP 500)** | — |
| 630 d | — | — | **crash del planificador** | — |

**Conclusiones:**
- **0 rechazos en todo el rango** → el GVNS nunca colapsa por *rutas*. Retrasa el
  colapso logístico más allá de lo medible.
- **`Ta` explota** entre 360 d (28 s) y 450 d (125 s) → **el colapso es TÉCNICO**:
  la solución acumulativa cae por tiempo/memoria a **~450–540 días (1.5–1.8 M
  envíos)**, no por rechazos.

### 3.2 Sim5D (5 días, EDF, t0 = 2026-07-20)

Para una ventana de 5 días, `Ta ≈ 1 s` (≈ 15 k envíos) — **muchísimo menor que
Sa**, así que la Sim5D es estable con amplio margen. La calibración aquí es por
**duración** (elegir K) y **granularidad** (elegir Sc), no por estabilidad.

---

## 4. Calibración por escenario

Estrategia simple: **fija `nº de bloques` y `Sa`**, y la duración sale sola
(`duración = bloques · Sa`). Con `Sa = 120 s` y `30 bloques` → **60 min** para
cualquier periodo. Luego `Sc = datos_totales / bloques` y `K = Sc / Sa`.

| Escenario | Datos totales | K (≈60 min) | Sc (con Sa=120 s) | Ta esperado | Estable |
|---|---|---|---|---|---|
| **Tiempo real (día a día)** | 1 día = 1440 min | **1** | = Sa (1:1) | ≈ 1 s | ✅ |
| **Periodo 3 días** | 4320 min | **72** | 144 min/bloque | ≈ 1 s | ✅ |
| **Periodo 5 días (Sim5D)** | 7200 min | **120** | 240 min/bloque | ≈ 1 s | ✅ |
| **Periodo 7 días** | 10080 min | **168** | 336 min/bloque | ≈ 1–2 s | ✅ |
| **Colapso** | hasta ~480 días | alto (calibrar) | grande | hasta **125 s** | cae a ~1.5 años |

### Tiempo real (día a día) — K = 1
No se comprime: 1 min real = 1 min de datos. Es operación "en vivo". `Sa` es solo
cada cuánto re-planificas (ej. 60 s); `Sc = Sa`. `Ta` (1 día de datos) ≪ `Sa`.
No aplica el rango 30–90 min (no es una simulación comprimida).

### Periodo (3/5/7 días) — K se calcula para durar 30–90 min
- Más días → más datos → **K mayor** (más aceleración) para caber en la misma
  duración. Por eso 7 días "estresa" más que 3.
- `Ta` sigue siendo ~1 s (la ventana es corta), así que `Sa` se elige por
  comodidad visual: **más bloques = animación más fluida**.

### Colapso
- Límite real ≈ **450–500 días** (donde `Ta` se dispara / OOM).
- `Ta` cerca del colapso ≈ **125 s** → si `Sa < 125 s`, la solución cae. Eso es
  lo que se demuestra.

---

## 5. Cómo continuar los tests

> Antes de cada corrida: planificador, consultas y mysql `active`
> (`systemctl is-active tasfb2b-planificador tasfb2b-consultas mysql`).

### Periodo 3 / 5 / 7 días
El harness reporta, por cada `Sc`, el `Sa` y `K` que hacen durar 30–90 min:
```bash
cd /opt/tasfb2b/backend/experimentos

# 3 días
go run . -fecha 2026-07-20T08:15 -dias 3 -sc 72,144,288 -muestras 0

# 5 días
go run . -fecha 2026-07-20T08:15 -dias 5 -sc 120,240,480 -muestras 0

# 7 días
go run . -fecha 2026-07-20T08:15 -dias 7 -sc 168,336,720 -muestras 0
```
Lee la columna **"¿factible 30-90?"**: te da `Sa≈`, `K≈` y `dur≈` recomendados.
Repite con varias fechas (`-fecha 2026-11-05T22:45`, `2027-03-14T04:04`) para
confirmar que `Ta < Sa` aguanta en fechas de más volumen.

### Tiempo real (día a día)
Como K=1 y la ventana es 1 día, basta confirmar que `Ta(1 día) ≪ Sa`:
```bash
go run . -fecha 2026-07-20T08:15 -dias 1 -sc 60,120 -muestras 0
```
`Sa` = cada cuánto refrescas (ej. 60 s). `Sc = Sa`. No se busca 30–90 min.

### Notas operativas (memoria de la VM, 4 GB)
- **No** pruebes horizontes de colapso > 450 días: tumban la VM (OOM). El límite
  ya está medido.
- El planificador corre con `-Xmx2g`. Si un barrido grande da HTTP 500, es OOM
  **controlado** (no se cae la VM); baja el horizonte.
- `-muestras 0` mide todos los bloques (preciso, lento). Usa `-muestras 6` para
  un tanteo rápido.

---

## 6. Glosario rápido para la presentación

- **Ta** = lo que tarda el algoritmo en planificar una vez (crece con el volumen).
- **Sa** = cada cuánto, en tiempo real, se relanza el algoritmo (lo fijas tú).
- **Sc** = cuánto tiempo de datos "se come" cada ejecución = `K · Sa`.
- **K** = cuántas veces más rápido corre el reloj de la simulación que el real.
- **Colapso técnico**: cuando `Ta > Sa` (la planificación no termina a tiempo).
- **Colapso logístico**: cuando hay rechazos (envíos sin ruta a tiempo). Con este
  dataset/EDF no aparece ni en 1.5 años — el técnico llega primero.
