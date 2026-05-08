package pe.edu.pucp.tasf.gvns;

/**
 * Fachada del motor de planificación GVNS para uso en aplicaciones web.
 *
 * <p>Reemplaza a {@link Main} como punto de entrada cuando el motor se
 * integra como módulo dentro de un monolito (ej. servlet en Tomcat).
 * No tiene estado estático: cada instancia gestiona su propia red y
 * puede ser inyectada por un contenedor IoC o instanciada manualmente.
 *
 * <h3>Uso típico desde un servlet o controlador:</h3>
 * <pre>{@code
 * PlanificadorService svc = new PlanificadorService(
 *     "/data/aeropuertos.txt",
 *     "/data/vuelos.txt",
 *     "/data/_envios_preliminar_"
 * );
 *
 * // Planificar el día 2026-08-18 con criterio EDF
 * long ini = GestorDatos.calcularEpochMinutos(2026, 8, 18, 0, 0, 0);
 * ResultadoPlanificacion r = svc.planificarDia(ini, CriterioOrden.EDF, 42L, true);
 * response.getWriter().println(r);
 * }</pre>
 *
 * <p><b>Hilo de seguridad:</b> {@code planificarDia} y {@code planificarVentana}
 * crean un {@link GestorDatos} y un {@link PlanificadorGVNSConcurrente} nuevos
 * en cada llamada, por lo que la instancia es segura para uso concurrente.
 */
public class PlanificadorService {

    private final String rutaAeropuertos;
    private final String rutaVuelos;
    private final String rutaEnvios;

    /**
     * @param rutaAeropuertos ruta absoluta o relativa al archivo aeropuertos.txt
     * @param rutaVuelos      ruta absoluta o relativa al archivo vuelos.txt
     * @param rutaEnvios      ruta al directorio _envios_preliminar_ (sin barra final)
     */
    public PlanificadorService(String rutaAeropuertos,
                               String rutaVuelos,
                               String rutaEnvios) {
        this.rutaAeropuertos = rutaAeropuertos;
        this.rutaVuelos      = rutaVuelos;
        this.rutaEnvios      = rutaEnvios;
    }

    // ── API principal ─────────────────────────────────────────────────────────

    /**
     * Planifica todos los envíos registrados en una ventana de 24 horas.
     *
     * @param ventanaIniUTC minuto UTC absoluto de inicio del día
     *                      (usar {@link GestorDatos#calcularEpochMinutos})
     * @param criterio      estrategia de ordenamiento de la Fase 2
     * @param semilla       semilla aleatoria (solo aplica a ALEATORIO)
     * @param validar       {@code true} para ejecutar el validador de invariantes
     * @return resultado inmutable con métricas de la planificación
     */
    public ResultadoPlanificacion planificarDia(long ventanaIniUTC,
                                               CriterioOrden criterio,
                                               long semilla,
                                               boolean validar) {
        return planificarVentana(ventanaIniUTC, ventanaIniUTC + 1440L,
                                 criterio, semilla, validar);
    }

    /**
     * Planifica todos los envíos registrados en una ventana arbitraria.
     *
     * @param ventanaIniUTC minuto UTC de inicio (inclusivo)
     * @param ventanaFinUTC minuto UTC de fin (exclusivo)
     * @param criterio      estrategia de ordenamiento de la Fase 2
     * @param semilla       semilla aleatoria (solo aplica a ALEATORIO)
     * @param validar       {@code true} para ejecutar el validador de invariantes
     * @return resultado inmutable con métricas de la planificación
     */
    public ResultadoPlanificacion planificarVentana(long ventanaIniUTC,
                                                    long ventanaFinUTC,
                                                    CriterioOrden criterio,
                                                    long semilla,
                                                    boolean validar) {
        // ── Cargar red ────────────────────────────────────────────────────────
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        datos.cargarVuelos(rutaVuelos);
        datos.cargarTodosLosEnvios(rutaEnvios, ventanaIniUTC, ventanaFinUTC);

        int totalEnvios = datos.numEnvios;
        if (totalEnvios == 0) {
            return vacio(ventanaIniUTC, ventanaFinUTC, criterio);
        }

        // ── Fase 2: construcción greedy ───────────────────────────────────────
        PlanificadorGVNSConcurrente plan =
                new PlanificadorGVNSConcurrente(datos, semilla, criterio);

        long t0 = System.currentTimeMillis();
        plan.construirSolucionInicial();
        double tFase2 = (System.currentTimeMillis() - t0) / 1000.0;

        int exitososF2 = plan.enviosExitosos.get();

        // ── Fase 3: GVNS (solo si hay rechazados) ────────────────────────────
        long t1 = System.currentTimeMillis();
        int iterMejoras = 0;
        if (exitososF2 < totalEnvios) {
            iterMejoras = plan.ejecutarMejoraGVNS();
        }
        double tFase3 = (System.currentTimeMillis() - t1) / 1000.0;

        int exitososF3 = plan.enviosExitosos.get();

        // ── Distribución por tramos ───────────────────────────────────────────
        int directas = 0, una = 0, dos = 0;
        for (int e = 0; e < totalEnvios; e++) {
            if (plan.solucionVuelos[e][0] == -1) continue;
            int tramos = 0;
            for (int s = 0; s < plan.MAX_SALTOS; s++)
                if (plan.solucionVuelos[e][s] != -1) tramos++;
            if      (tramos == 1) directas++;
            else if (tramos == 2) una++;
            else if (tramos == 3) dos++;
        }

        // ── Validar invariantes (opcional) ────────────────────────────────────
        boolean valida = !validar || AnalizadorRed.validarSolucion(plan, datos);

        return new ResultadoPlanificacion(
                ventanaIniUTC, ventanaFinUTC, criterio,
                totalEnvios,
                exitososF3,
                totalEnvios - exitososF3,
                exitososF3 - exitososF2,
                plan.calcularTransitoTotal(),
                directas, una, dos,
                tFase2, tFase3, iterMejoras,
                valida);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Resultado vacío cuando no hay envíos en la ventana. */
    private static ResultadoPlanificacion vacio(long ini, long fin,
                                                CriterioOrden criterio) {
        return new ResultadoPlanificacion(ini, fin, criterio,
                0, 0, 0, 0, 0L, 0, 0, 0, 0.0, 0.0, 0, true);
    }
}
