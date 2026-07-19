# Correcciones aplicadas al frontend Tasf.B2B

Se aplicaron las siguientes correcciones solicitadas:

1. **Cabecera reducida de 3 filas a 2 filas**
   - Se fusionó la fila del título con la fila de navegación.
   - Ahora la cabecera superior muestra título, subtítulo, menú, selector de tema y salida en una sola franja.
   - La segunda franja queda para estado, tipo de simulación, fecha de inicio, tiempo simulado, progreso, contadores y controles.

2. **Información de simulación visible**
   - En la barra de estado se muestra el tipo de simulación:
     - Simulación 5D
     - Operación día a día
     - Simulación hasta el colapso
   - También se muestra la fecha/hora de inicio elegida.

3. **Capacidades de vuelos corregidas visualmente**
   - El panel lateral ya no muestra una capacidad falsa cuando no puede resolver el vuelo real.
   - Si la capacidad real se encuentra, muestra `carga/capacidad`.
   - Si no se puede resolver, muestra `maletas del tramo` y una nota aclaratoria.

4. **Línea punteada al destino**
   - La ruta sólida representa el tramo recorrido: origen → avión.
   - La ruta punteada representa el tramo pendiente: avión → destino.
   - Se agregó explicación en la leyenda.

## Archivos modificados

- `Frontend/src/app/components/Layout.tsx`
- `Frontend/src/app/components/Navigation.tsx`
- `Frontend/src/app/pages/UnifiedDashboard.tsx`
- `Frontend/src/app/components/Map.tsx`

## Validación

Se ejecutó:

```bash
cd Frontend
npm install --include=optional
npm run build
```

El build terminó correctamente.
