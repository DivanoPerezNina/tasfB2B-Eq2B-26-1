package pe.edu.pucp.tasf.gvns;

import java.io.IOException;
import java.util.List;

/**
 * DTO que representa un envío con su ruta asignada tras ejecutar el GVNS.
 *
 * <p>Producido por {@link PlanificadorService#planificarConRutas}.
 * Diseñado para serialización JSON hacia el Ejecutor (Go) o cualquier
 * cliente HTTP que necesite la solución completa, no solo las métricas.
 *
 * <p>Un envío puede estar en estado:
 * <ul>
 *   <li>{@code "Exitoso"}    — tiene ruta asignada (tramos no vacío).</li>
 *   <li>{@code "Rechazado"}  — no se encontró ruta factible.</li>
 * </ul>
 */
public final class EnvioAsignado {

    /** Índice interno del envío dentro del GestorDatos (0-based). */
    public final int    indice;
    /** Código IATA del aeropuerto de origen. */
    public final String origen;
    /** Código IATA del aeropuerto de destino. */
    public final String destino;
    /** Cantidad de maletas del envío. */
    public final int    maletas;
    /** Minuto UTC absoluto (desde Epoch 1970-01-01) en que se registró el envío. */
    public final long   registroUTC;
    /** Minuto UTC absoluto del deadline de entrega. */
    public final long   deadlineUTC;
    /** "Exitoso" o "Rechazado". */
    public final String estado;
    /** Tramos de la ruta (vacío si rechazado). */
    public final List<Tramo> tramos;

    public EnvioAsignado(int indice, String origen, String destino,
                         int maletas, long registroUTC, long deadlineUTC,
                         String estado, List<Tramo> tramos) {
        this.indice      = indice;
        this.origen      = origen;
        this.destino     = destino;
        this.maletas     = maletas;
        this.registroUTC = registroUTC;
        this.deadlineUTC = deadlineUTC;
        this.estado      = estado;
        this.tramos      = tramos;
    }

    /** Un tramo representa un vuelo individual dentro de la ruta. */
    public static final class Tramo {
        /** Índice del vuelo en el GestorDatos (permite lookup de capacidad, etc.). */
        public final int    vueloIdx;
        /** ID de vuelos_operacion; 0 para rutas del archivo histórico. */
        public final long   vueloId;
        /** Código IATA del aeropuerto de salida del tramo. */
        public final String desde;
        /** Código IATA del aeropuerto de llegada del tramo. */
        public final String hasta;
        /** Minuto UTC absoluto de salida del vuelo en este tramo. */
        public final long   salidaUTC;
        /** Minuto UTC absoluto de llegada del vuelo en este tramo. */
        public final long   llegadaUTC;

        public Tramo(int vueloIdx, String desde, String hasta,
                     long salidaUTC, long llegadaUTC) {
            this(vueloIdx, 0L, desde, hasta, salidaUTC, llegadaUTC);
        }

        public Tramo(int vueloIdx, long vueloId, String desde, String hasta,
                     long salidaUTC, long llegadaUTC) {
            this.vueloIdx  = vueloIdx;
            this.vueloId   = vueloId;
            this.desde     = desde;
            this.hasta     = hasta;
            this.salidaUTC = salidaUTC;
            this.llegadaUTC = llegadaUTC;
        }
    }

    // ── Serialización JSON manual (sin Jackson) ───────────────────────────────

    /**
     * Escribe este envío como objeto JSON en un {@link Appendable} cualquiera.
     *
     * <p>Acepta {@code Appendable} (no solo {@code StringBuilder}) para poder
     * escribir directo al {@code Writer} de la respuesta HTTP y evitar construir
     * un String gigante del plan completo en memoria — el mayor pico de heap del
     * esquema Sa/Sc a horizontes grandes.
     */
    public void appendJSON(Appendable out) throws IOException {
        out.append("{\"indice\":").append(Integer.toString(indice));
        out.append(",\"origen\":\"").append(origen).append("\",\"destino\":\"").append(destino);
        out.append("\",\"maletas\":").append(Integer.toString(maletas));
        out.append(",\"registroUTC\":").append(Long.toString(registroUTC));
        out.append(",\"deadlineUTC\":").append(Long.toString(deadlineUTC));
        out.append(",\"estado\":\"").append(estado).append("\",\"tramos\":[");
        for (int i = 0; i < tramos.size(); i++) {
            if (i > 0) out.append(',');
            Tramo t = tramos.get(i);
            out.append("{\"vueloIdx\":").append(Integer.toString(t.vueloIdx));
            out.append(",\"vueloId\":").append(Long.toString(t.vueloId));
            out.append(",\"desde\":\"").append(t.desde).append("\",\"hasta\":\"").append(t.hasta);
            out.append("\",\"salidaUTC\":").append(Long.toString(t.salidaUTC));
            out.append(",\"llegadaUTC\":").append(Long.toString(t.llegadaUTC));
            out.append('}');
        }
        out.append("]}");
    }
}
