package pe.edu.pucp.tasf.gvns;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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

    // ── API extendida: rutas completas para el Ejecutor ──────────────────────

    /**
     * Planifica una ventana y devuelve la lista completa de envíos con sus
     * rutas asignadas. A diferencia de {@link #planificarVentana}, este método
     * retorna los detalles por envío que el Ejecutor necesita para simular
     * el movimiento tick a tick.
     *
     * @param ventanaIniUTC minuto UTC de inicio (inclusivo)
     * @param ventanaFinUTC minuto UTC de fin (exclusivo)
     * @param criterio      estrategia de ordenamiento
     * @param semilla       semilla aleatoria (solo aplica a ALEATORIO)
     * @return lista de envíos con estado y tramos; nunca null
     */
    public List<EnvioAsignado> planificarConRutas(long ventanaIniUTC,
                                                   long ventanaFinUTC,
                                                   CriterioOrden criterio,
                                                   long semilla) {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        datos.cargarVuelos(rutaVuelos);
        datos.cargarTodosLosEnvios(rutaEnvios, ventanaIniUTC, ventanaFinUTC);
        return construirRutas(datos, criterio, semilla);
    }

    /**
     * Igual que {@link #planificarConRutas} pero los envíos vienen en una LISTA
     * (consultados de la BD por el servicio de Consultas) en vez de leerse de
     * archivos. Java no toca disco ni BD para los envíos → menos RAM/IO.
     */
    public List<EnvioAsignado> planificarConRutasDesdeLista(
            List<EnvioDTO> envios, CriterioOrden criterio, long semilla) {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        datos.cargarVuelos(rutaVuelos);
        datos.cargarEnviosDesdeArray(envios);
        return construirRutas(datos, criterio, semilla);
    }

    /** Corre el GVNS sobre datos ya cargados (Fase 2 + GVNS si quedan rechazos). */
    private static PlanificadorGVNSConcurrente correrSolver(GestorDatos datos,
                                                            CriterioOrden criterio, long semilla,
                                                            java.util.Set<Long> diasCancelados) {
        PlanificadorGVNSConcurrente plan =
                new PlanificadorGVNSConcurrente(datos, semilla, criterio);
        plan.setDiasCancelados(diasCancelados);
        plan.construirSolucionInicial();
        if (plan.enviosExitosos.get() < datos.numEnvios) {
            plan.ejecutarMejoraGVNS();
        }
        return plan;
    }

    /** Construye el {@link EnvioAsignado} del envío {@code e} a partir de la solución del solver. */
    static EnvioAsignado construirUno(GestorDatos datos, PlanificadorGVNSConcurrente plan, int e) {
        String origen  = datos.iataAeropuerto[datos.envioOrigen[e]];
        String destino = datos.iataAeropuerto[datos.envioDestino[e]];
        long   regUTC  = datos.envioRegistroUTC[e];
        long   dlUTC   = datos.envioDeadlineUTC[e];

        if (plan.solucionVuelos[e][0] == -1) {
            return new EnvioAsignado(e, origen, destino, datos.envioMaletas[e],
                    regUTC, dlUTC, "Rechazado", new ArrayList<>());
        }

        List<EnvioAsignado.Tramo> tramos = new ArrayList<>(3);
        for (int s = 0; s < plan.MAX_SALTOS; s++) {
            int v = plan.solucionVuelos[e][s];
            if (v == -1) break;

            long salida  = plan.solucionDias[e][s];
            long durMin  = datos.vueloLlegadaUTC[v] - datos.vueloSalidaUTC[v];
            if (durMin < 0) durMin += 1440;
            long llegada = salida + durMin;

            tramos.add(new EnvioAsignado.Tramo(
                    v,
                    datos.iataAeropuerto[datos.vueloOrigen[v]],
                    datos.iataAeropuerto[datos.vueloDestino[v]],
                    salida, llegada));
        }
        return new EnvioAsignado(e, origen, destino, datos.envioMaletas[e],
                regUTC, dlUTC, "Exitoso", tramos);
    }

    /** Corre el GVNS sobre datos ya cargados y construye la lista de rutas. */
    private List<EnvioAsignado> construirRutas(GestorDatos datos,
                                               CriterioOrden criterio, long semilla) {
        int total = datos.numEnvios;
        List<EnvioAsignado> resultado = new ArrayList<>(total);
        if (total == 0) return resultado;

        PlanificadorGVNSConcurrente plan = correrSolver(datos, criterio, semilla, null);
        for (int e = 0; e < total; e++) {
            resultado.add(construirUno(datos, plan, e));
        }
        return resultado;
    }

    /**
     * Serializa la lista de EnvioAsignado a JSON sin dependencias externas.
     * Útil para devolver el plan completo como respuesta HTTP desde el
     * Spring Boot wrapper.
     *
     * @param envios            lista devuelta por {@link #planificarConRutas}
     * @param meta              ResultadoPlanificacion para el bloque "resumen"
     * @param observacionIniUTC minuto UTC donde arranca la simulación VISIBLE en
     *                          tiempo real. Con warm-up es mayor que
     *                          {@code meta.ventanaIniUTC} (el tramo previo es el
     *                          pre-roll que el Ejecutor reproduce acelerado).
     * @return cadena JSON
     */
    public static String serializarPlanJSON(List<EnvioAsignado> envios,
                                             ResultadoPlanificacion meta,
                                             long observacionIniUTC,
                                             Map<String, Integer> capacidades) {
        StringBuilder sb = new StringBuilder(envios.size() * 200);
        try {
            serializarPlanJSON(sb, envios, meta, observacionIniUTC, capacidades);
        } catch (IOException e) {
            throw new UncheckedIOException(e); // StringBuilder no lanza IOException
        }
        return sb.toString();
    }

    /**
     * Igual que {@link #serializarPlanJSON(List, ResultadoPlanificacion, long, Map)}
     * pero escribe el plan a un {@link Appendable} (ej. el {@code Writer} de la
     * respuesta HTTP) en vez de materializar un String. A horizontes grandes el
     * String del plan completo + su copia en {@code toString()} eran ~1 GB de pico
     * transitorio; escribirlo en streaming los elimina. El JSON es byte-idéntico.
     */
    public static void serializarPlanJSON(Appendable out,
                                          List<EnvioAsignado> envios,
                                          ResultadoPlanificacion meta,
                                          long observacionIniUTC,
                                          Map<String, Integer> capacidades) throws IOException {
        appendCabecera(out, meta, observacionIniUTC, capacidades);
        for (int i = 0; i < envios.size(); i++) {
            if (i > 0) out.append(',');
            envios.get(i).appendJSON(out);
        }
        out.append("]}");
    }

    /** Escribe {@code {"resumen":{...},"aeropuertos":[...],"envios":[} — sin cerrar el array. */
    private static void appendCabecera(Appendable out, ResultadoPlanificacion meta,
                                       long observacionIniUTC,
                                       Map<String, Integer> capacidades) throws IOException {
        out.append("{\"resumen\":{");
        out.append("\"totalEnvios\":").append(Integer.toString(meta.totalEnvios));
        out.append(",\"exitosos\":").append(Integer.toString(meta.exitosos));
        out.append(",\"rechazados\":").append(Integer.toString(meta.rechazados));
        out.append(",\"salvadosPorGVNS\":").append(Integer.toString(meta.salvadosPorGVNS));
        out.append(",\"tasaExito\":").append(String.format("%.4f", meta.tasaExito));
        out.append(",\"tiempoFase2Seg\":").append(String.format("%.3f", meta.tiempoFase2Seg));
        out.append(",\"tiempoFase3Seg\":").append(String.format("%.3f", meta.tiempoFase3Seg));
        out.append(",\"ventanaIniUTC\":").append(Long.toString(meta.ventanaIniUTC));
        out.append(",\"ventanaFinUTC\":").append(Long.toString(meta.ventanaFinUTC));
        out.append(",\"observacionIniUTC\":").append(Long.toString(observacionIniUTC));
        out.append("},");

        // Capacidades reales de almacén por aeropuerto (para que el Ejecutor
        // calcule ocupación y semáforo contra el valor correcto, no un default).
        out.append("\"aeropuertos\":[");
        if (capacidades != null) {
            boolean first = true;
            for (Map.Entry<String, Integer> e : capacidades.entrySet()) {
                if (!first) out.append(',');
                first = false;
                out.append("{\"iata\":\"").append(e.getKey())
                   .append("\",\"capacidad\":").append(Integer.toString(e.getValue())).append('}');
            }
        }
        out.append("],");
        out.append("\"envios\":[");
    }

    /**
     * Planifica desde una lista de envíos y escribe el plan en streaming al
     * {@code out}, <b>sin materializar la lista de {@link EnvioAsignado}</b>: cada
     * envío se construye, se serializa y se descarta. A horizontes grandes esa
     * lista era ~600 MB; eliminarla (junto al String del plan, ya en streaming)
     * baja el pico de heap lo suficiente para alcanzar volúmenes mayores antes del
     * colapso. El JSON es byte-idéntico al de {@link #serializarPlanJSON}.
     */
    public void planificarYStreamDesdeLista(List<EnvioDTO> envios, CriterioOrden criterio,
                                            long semilla, long iniUTC, long finUTC,
                                            long observacionIniUTC, List<CancelacionDTO> cancelados,
                                            Appendable out) throws IOException {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        datos.cargarVuelos(rutaVuelos);
        datos.cargarEnviosDesdeArray(envios);

        java.util.Set<Long> diasCancelados = clavesCanceladas(cancelados);
        int total = datos.numEnvios;
        Map<String, Integer> caps = capacidadesDe(datos);

        if (total == 0) {
            ResultadoPlanificacion meta = new ResultadoPlanificacion(
                    iniUTC, finUTC, criterio, 0, 0, 0, 0, 0L, 0, 0, 0, 0.0, 0.0, 0, true);
            appendCabecera(out, meta, observacionIniUTC, caps);
            out.append("]}");
            return;
        }

        PlanificadorGVNSConcurrente plan = correrSolver(datos, criterio, semilla, diasCancelados);

        // Pasada 1: contar exitosos (envío con al menos un tramo asignado).
        int exitosos = 0;
        for (int e = 0; e < total; e++) {
            if (plan.solucionVuelos[e][0] != -1) exitosos++;
        }
        // meta espejo de metaDesdeEnvios: salvados/tiempos en 0 (no se serializan los demás).
        ResultadoPlanificacion meta = new ResultadoPlanificacion(
                iniUTC, finUTC, criterio, total, exitosos, total - exitosos, 0,
                0L, 0, 0, 0, 0.0, 0.0, 0, true);

        // Pasada 2: escribir cada envío sin retenerlo.
        appendCabecera(out, meta, observacionIniUTC, caps);
        for (int e = 0; e < total; e++) {
            if (e > 0) out.append(',');
            construirUno(datos, plan, e).appendJSON(out);
        }
        out.append("]}");
    }

    /** Traduce las cancelaciones (vueloIdx, salidaUTC) a claves claveVueloDia para el solver. */
    static java.util.Set<Long> clavesCanceladas(List<CancelacionDTO> cancelados) {
        if (cancelados == null || cancelados.isEmpty()) return java.util.Collections.emptySet();
        java.util.Set<Long> claves = new java.util.HashSet<>(cancelados.size() * 2);
        for (CancelacionDTO c : cancelados) {
            if (c == null) continue;
            claves.add(PlanificadorGVNSConcurrente.claveVueloDia(c.vueloIdx(), c.salidaUTC()));
        }
        return claves;
    }

    /** Capacidades IATA → almacén a partir de un GestorDatos ya con aeropuertos cargados. */
    private static Map<String, Integer> capacidadesDe(GestorDatos datos) {
        Map<String, Integer> m = new LinkedHashMap<>();
        for (int i = 1; i <= datos.numAeropuertos; i++) {
            m.put(datos.iataAeropuerto[i], datos.capacidadAlmacen[i]);
        }
        return m;
    }

    /**
     * Devuelve un mapa IATA → capacidad de almacén leyendo el archivo de
     * aeropuertos (archivo pequeño; carga independiente y barata). Lo usa el
     * controlador para incluir las capacidades reales en el plan JSON.
     */
    public Map<String, Integer> capacidadesAlmacen() {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        Map<String, Integer> m = new LinkedHashMap<>();
        for (int i = 1; i <= datos.numAeropuertos; i++) {
            m.put(datos.iataAeropuerto[i], datos.capacidadAlmacen[i]);
        }
        return m;
    }

    /**
     * Construye el {@link ResultadoPlanificacion} (métricas del "resumen") a
     * partir de la lista de envíos ya planificada por {@link #planificarConRutas},
     * SIN volver a cargar archivos ni re-ejecutar el GVNS.
     *
     * <p>Antes el controlador llamaba {@code planificarVentana} (para las métricas)
     * y {@code planificarConRutas} (para las rutas) por separado: dos cargas de
     * archivos y dos corridas completas de GVNS por job. Este helper deriva las
     * métricas de la única corrida de {@code planificarConRutas}.
     */
    public static ResultadoPlanificacion metaDesdeEnvios(List<EnvioAsignado> envios,
                                                         long ventanaIniUTC,
                                                         long ventanaFinUTC,
                                                         CriterioOrden criterio) {
        int total = envios.size();
        int exitosos = 0, directas = 0, una = 0, dos = 0;
        long transito = 0;
        for (EnvioAsignado e : envios) {
            if (!"Exitoso".equals(e.estado) || e.tramos.isEmpty()) continue;
            exitosos++;
            int n = e.tramos.size();
            if      (n == 1) directas++;
            else if (n == 2) una++;
            else if (n >= 3) dos++;
            EnvioAsignado.Tramo ultimo = e.tramos.get(n - 1);
            transito += (ultimo.llegadaUTC - e.registroUTC);
        }
        return new ResultadoPlanificacion(
                ventanaIniUTC, ventanaFinUTC, criterio,
                total, exitosos, total - exitosos, 0,
                transito, directas, una, dos,
                0.0, 0.0, 0, true);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Resultado vacío cuando no hay envíos en la ventana. */
    private static ResultadoPlanificacion vacio(long ini, long fin,
                                                CriterioOrden criterio) {
        return new ResultadoPlanificacion(ini, fin, criterio,
                0, 0, 0, 0, 0L, 0, 0, 0, 0.0, 0.0, 0, true);
    }
}
