package pe.edu.pucp.tasf.gvns;

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
            this.vueloIdx  = vueloIdx;
            this.desde     = desde;
            this.hasta     = hasta;
            this.salidaUTC = salidaUTC;
            this.llegadaUTC = llegadaUTC;
        }
    }

    // ── Serialización JSON manual (sin Jackson) ───────────────────────────────

    /** Escribe este envío como objeto JSON en el StringBuilder. */
    public void appendJSON(StringBuilder sb) {
        sb.append("{");
        sb.append("\"indice\":").append(indice).append(',');
        sb.append("\"origen\":\"").append(origen).append("\",");
        sb.append("\"destino\":\"").append(destino).append("\",");
        sb.append("\"maletas\":").append(maletas).append(',');
        sb.append("\"registroUTC\":").append(registroUTC).append(',');
        sb.append("\"deadlineUTC\":").append(deadlineUTC).append(',');
        sb.append("\"estado\":\"").append(estado).append("\",");
        sb.append("\"tramos\":[");
        for (int i = 0; i < tramos.size(); i++) {
            if (i > 0) sb.append(',');
            Tramo t = tramos.get(i);
            sb.append("{");
            sb.append("\"vueloIdx\":").append(t.vueloIdx).append(',');
            sb.append("\"desde\":\"").append(t.desde).append("\",");
            sb.append("\"hasta\":\"").append(t.hasta).append("\",");
            sb.append("\"salidaUTC\":").append(t.salidaUTC).append(',');
            sb.append("\"llegadaUTC\":").append(t.llegadaUTC);
            sb.append("}");
        }
        sb.append("]}");
    }
}
