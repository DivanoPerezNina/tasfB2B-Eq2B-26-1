package pe.edu.pucp.tasf.gvns;

/**
 * DTO inmutable con el resultado de una ejecución completa del motor GVNS.
 *
 * <p>Producido por {@link PlanificadorService#planificarDia} y
 * {@link PlanificadorService#planificarVentana}. Expone los indicadores
 * clave sin revelar la estructura interna del planificador.
 */
public final class ResultadoPlanificacion {

    // ── Identificación de la corrida ─────────────────────────────────────────
    /** Minuto UTC absoluto de inicio de la ventana planificada. */
    public final long ventanaIniUTC;
    /** Minuto UTC absoluto de fin de la ventana planificada. */
    public final long ventanaFinUTC;
    /** Criterio de ordenamiento usado en Fase 2. */
    public final CriterioOrden criterio;

    // ── Volúmenes ────────────────────────────────────────────────────────────
    /** Total de envíos en la ventana. */
    public final int totalEnvios;
    /** Envíos con ruta asignada al finalizar Fase 3. */
    public final int exitosos;
    /** Envíos sin ruta (rechazados) al finalizar Fase 3. */
    public final int rechazados;
    /** Envíos que Fase 2 dejó sin ruta pero el GVNS recuperó. */
    public final int salvadosPorGVNS;

    // ── Calidad ──────────────────────────────────────────────────────────────
    /** Tránsito total (min) de todos los envíos exitosos al finalizar Fase 3. */
    public final long transitoTotalMin;
    /** Tránsito promedio por envío exitoso (min). 0 si no hay exitosos. */
    public final double transitoPromedioMin;
    /** Tasa de éxito: exitosos / totalEnvios (0.0–1.0). */
    public final double tasaExito;

    // ── Distribución por tramos ──────────────────────────────────────────────
    /** Envíos ruteados en vuelo directo (1 tramo). */
    public final int rutasDirectas;
    /** Envíos ruteados con 1 escala (2 tramos). */
    public final int rutas1Escala;
    /** Envíos ruteados con 2 escalas (3 tramos). */
    public final int rutas2Escalas;

    // ── Tiempos de CPU ───────────────────────────────────────────────────────
    /** Segundos de CPU invertidos en Fase 2 (construcción greedy). */
    public final double tiempoFase2Seg;
    /** Segundos de CPU invertidos en Fase 3 (GVNS). */
    public final double tiempoFase3Seg;
    /** Iteraciones de mejora aceptadas por el GVNS. */
    public final int iteracionesMejora;

    // ── Validación ───────────────────────────────────────────────────────────
    /**
     * {@code true} si la solución pasó los 5 invariantes del validador
     * (causalidad, continuidad, conexión, SLA, sin overbooking).
     * Solo disponible cuando se llamó con {@code validar = true}.
     */
    public final boolean solucionValida;

    ResultadoPlanificacion(
            long ventanaIniUTC, long ventanaFinUTC, CriterioOrden criterio,
            int totalEnvios, int exitosos, int rechazados, int salvadosPorGVNS,
            long transitoTotalMin,
            int rutasDirectas, int rutas1Escala, int rutas2Escalas,
            double tiempoFase2Seg, double tiempoFase3Seg, int iteracionesMejora,
            boolean solucionValida) {

        this.ventanaIniUTC    = ventanaIniUTC;
        this.ventanaFinUTC    = ventanaFinUTC;
        this.criterio         = criterio;
        this.totalEnvios      = totalEnvios;
        this.exitosos         = exitosos;
        this.rechazados       = rechazados;
        this.salvadosPorGVNS  = salvadosPorGVNS;
        this.transitoTotalMin = transitoTotalMin;
        this.transitoPromedioMin = exitosos > 0 ? (double) transitoTotalMin / exitosos : 0.0;
        this.tasaExito        = totalEnvios > 0 ? (double) exitosos / totalEnvios : 0.0;
        this.rutasDirectas    = rutasDirectas;
        this.rutas1Escala     = rutas1Escala;
        this.rutas2Escalas    = rutas2Escalas;
        this.tiempoFase2Seg   = tiempoFase2Seg;
        this.tiempoFase3Seg   = tiempoFase3Seg;
        this.iteracionesMejora = iteracionesMejora;
        this.solucionValida   = solucionValida;
    }

    @Override
    public String toString() {
        return String.format(
            "ResultadoPlanificacion{ventana=[%d,%d], total=%d, exitosos=%d(%.1f%%), " +
            "rechazados=%d, transitoPromedio=%.1fmin, valido=%b}",
            ventanaIniUTC, ventanaFinUTC, totalEnvios,
            exitosos, tasaExito * 100, rechazados,
            transitoPromedioMin, solucionValida);
    }
}
