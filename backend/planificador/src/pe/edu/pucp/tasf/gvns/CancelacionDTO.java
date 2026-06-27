package pe.edu.pucp.tasf.gvns;

/**
 * Cancelación de una OCURRENCIA de vuelo (un (vuelo, día) concreto), tal como
 * llega en {@code POST /api/planificacion/desde-datos}.
 *
 * <p>Identifica el vuelo por su índice ({@code vueloIdx}, el mismo que viaja en
 * los tramos del plan hacia el frontend) y el día por {@code salidaUTC} (minuto
 * UTC absoluto de la salida de esa ocurrencia). El planificador la traduce a la
 * clave {@link PlanificadorGVNSConcurrente#claveVueloDia} y salta ese (vuelo,día)
 * en la planificación. Cancelar una ocurrencia NO afecta al mismo vuelo en otros
 * días.
 */
public record CancelacionDTO(int vueloIdx, long salidaUTC) {
}
