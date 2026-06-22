package pe.edu.pucp.tasf.gvns;

import org.junit.jupiter.api.Test;

import java.io.StringWriter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Blinda la serialización del plan tras pasarla a streaming (cambio que elimina
 * el String gigante del plan completo en memoria). Dos garantías:
 *  1. {@link EnvioAsignado#appendJSON} produce EXACTAMENTE el mismo formato de
 *     antes (el Ejecutor en Go parsea ese JSON; un cambio de formato lo rompe).
 *  2. La ruta String y la ruta Appendable (Writer) producen bytes idénticos.
 */
class SerializacionPlanTest {

    private static EnvioAsignado exitoso() {
        return new EnvioAsignado(0, "AAAA", "BBBB", 5, 1000L, 2440L, "Exitoso",
                List.of(new EnvioAsignado.Tramo(7, "AAAA", "BBBB", 1010L, 1130L)));
    }

    @Test
    void appendJSONMantieneFormatoExacto() throws Exception {
        StringBuilder sb = new StringBuilder();
        exitoso().appendJSON(sb);
        // Formato congelado: sin floats → independiente del locale.
        assertEquals(
            "{\"indice\":0,\"origen\":\"AAAA\",\"destino\":\"BBBB\",\"maletas\":5,"
          + "\"registroUTC\":1000,\"deadlineUTC\":2440,\"estado\":\"Exitoso\","
          + "\"tramos\":[{\"vueloIdx\":7,\"desde\":\"AAAA\",\"hasta\":\"BBBB\","
          + "\"salidaUTC\":1010,\"llegadaUTC\":1130}]}",
            sb.toString());
    }

    @Test
    void rechazadoSerializaTramosVacios() throws Exception {
        StringBuilder sb = new StringBuilder();
        new EnvioAsignado(1, "AAAA", "BBBB", 2, 0L, 1440L, "Rechazado", List.of())
                .appendJSON(sb);
        assertTrue(sb.toString().endsWith("\"estado\":\"Rechazado\",\"tramos\":[]}"),
                "rechazado debe terminar con tramos vacíos: " + sb);
    }

    @Test
    void streamYStringProducenBytesIdenticos() throws Exception {
        List<EnvioAsignado> plan = List.of(
                exitoso(),
                new EnvioAsignado(1, "BBBB", "AAAA", 2, 5000L, 7880L, "Rechazado", List.of()));
        ResultadoPlanificacion meta = PlanificadorService.metaDesdeEnvios(plan, 0L, 7200L, CriterioOrden.EDF);
        Map<String, Integer> caps = new LinkedHashMap<>();
        caps.put("AAAA", 400);
        caps.put("BBBB", 300);

        String porString = PlanificadorService.serializarPlanJSON(plan, meta, 0L, caps);

        StringWriter sw = new StringWriter();
        PlanificadorService.serializarPlanJSON(sw, plan, meta, 0L, caps);

        assertEquals(porString, sw.toString(), "stream y String deben coincidir byte a byte");
        // Sanidad estructural mínima.
        assertTrue(porString.startsWith("{\"resumen\":{\"totalEnvios\":2,"));
        assertTrue(porString.contains("\"aeropuertos\":[{\"iata\":\"AAAA\",\"capacidad\":400}"));
        assertTrue(porString.endsWith("]}"));
    }
}
