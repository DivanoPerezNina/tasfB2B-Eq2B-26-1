package pe.edu.pucp.tasf.gvns;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Valida que el planificador NO use un (vuelo, día) cancelado y que la
 * cancelación sea por ocurrencia (no afecta el mismo vuelo en otros días).
 *
 * Escenario mínimo en memoria (sin archivos): 2 aeropuertos, 1 vuelo directo
 * A→B (sale 10:00, dura 2 h), 1 envío A→B registrado el día 10 a las 00:00.
 */
class CancelacionPlanTest {

    private static final long DIA = 10;
    private static final long SALIDA_DIA = 600;            // 10:00 en minutos del día
    private static final long SALIDA_ABS = DIA * 1440 + SALIDA_DIA;

    private static GestorDatos datosAB() {
        GestorDatos d = new GestorDatos();
        d.numAeropuertos = 2;
        d.mapaIataAId.put("AAAA", 1);
        d.mapaIataAId.put("BBBB", 2);
        d.iataAeropuerto[1] = "AAAA"; d.iataAeropuerto[2] = "BBBB";
        d.capacidadAlmacen[1] = 1000; d.capacidadAlmacen[2] = 1000;
        d.continenteAero[1] = 1; d.continenteAero[2] = 1;

        d.numVuelos = 1;
        d.vueloOrigen[0] = 1; d.vueloDestino[0] = 2;
        d.vueloSalidaUTC[0] = (int) SALIDA_DIA; d.vueloLlegadaUTC[0] = (int) SALIDA_DIA + 120;
        d.vueloCapacidad[0] = 100;

        d.numEnvios = 1;
        d.envioOrigen      = new int[]{1};
        d.envioDestino     = new int[]{2};
        d.envioMaletas     = new int[]{3};
        d.envioRegistroUTC = new long[]{DIA * 1440};
        d.envioDeadlineUTC = new long[]{SALIDA_ABS + 120 + 1000}; // holgado
        return d;
    }

    private static PlanificadorGVNSConcurrente correr(GestorDatos d, Set<Long> cancelados) {
        PlanificadorGVNSConcurrente p = new PlanificadorGVNSConcurrente(d, 42L, CriterioOrden.EDF);
        // Las pruebas verifican factibilidad/cancelaciones, no la calidad tras
        // dos minutos de metaheurística. Un límite corto evita que cada build de
        // despliegue tarde 120 s cuando el caso de prueba deja un envío sin ruta.
        p.TIEMPO_LIMITE_MS = 200L;
        p.setDiasCancelados(cancelados);
        p.construirSolucionInicial();
        if (p.enviosExitosos.get() < d.numEnvios) p.ejecutarMejoraGVNS();
        return p;
    }

    @Test
    void sinCancelacionAsignaElVuelo() {
        PlanificadorGVNSConcurrente p = correr(datosAB(), Set.of());
        assertEquals(0, p.solucionVuelos[0][0], "sin cancelación debe usar el vuelo 0");
    }

    @Test
    void cancelarEseVueloDiaLoRechaza() {
        long clave = PlanificadorGVNSConcurrente.claveVueloDia(0, SALIDA_ABS);
        PlanificadorGVNSConcurrente p = correr(datosAB(), Set.of(clave));
        assertEquals(-1, p.solucionVuelos[0][0],
                "el (vuelo,día) cancelado no debe usarse → envío sin ruta");
    }

    @Test
    void cancelarOtroDiaNoAfecta() {
        long claveOtroDia = PlanificadorGVNSConcurrente.claveVueloDia(0, (DIA + 5) * 1440 + SALIDA_DIA);
        PlanificadorGVNSConcurrente p = correr(datosAB(), Set.of(claveOtroDia));
        assertEquals(0, p.solucionVuelos[0][0], "cancelar otro día no debe afectar a este");
    }


    @Test
    void vueloIdExactoNoCancelaSalidasVecinas() {
        GestorDatos d = datosAB();
        d.numVuelos = 3;
        d.vueloOrigen[0] = 1; d.vueloDestino[0] = 2; d.vueloSalidaUTC[0] = 815; d.vueloLlegadaUTC[0] = 1380; d.vueloCapacidad[0] = 150; d.vueloIdExterno[0] = 101;
        d.vueloOrigen[1] = 1; d.vueloDestino[1] = 2; d.vueloSalidaUTC[1] = 816; d.vueloLlegadaUTC[1] = 1380; d.vueloCapacidad[1] = 150; d.vueloIdExterno[1] = 102;
        d.vueloOrigen[2] = 1; d.vueloDestino[2] = 2; d.vueloSalidaUTC[2] = 817; d.vueloLlegadaUTC[2] = 1380; d.vueloCapacidad[2] = 150; d.vueloIdExterno[2] = 103;

        long dia = 20L * 1440L;
        // salidaUTC está deliberadamente corrida cinco minutos. Con vueloId la
        // cancelación sigue siendo exacta y solo usa el día de la ocurrencia.
        Set<Long> claves = PlanificadorService.clavesCanceladas(
                d, List.of(new CancelacionDTO(101L, "AAAA", "BBBB", dia + 820)));

        assertEquals(Set.of(PlanificadorGVNSConcurrente.claveVueloDia(0, dia + 820)), claves);
        assertFalse(claves.contains(PlanificadorGVNSConcurrente.claveVueloDia(1, dia + 820)));
        assertFalse(claves.contains(PlanificadorGVNSConcurrente.claveVueloDia(2, dia + 820)));
    }

    @Test
    void fallbackSinVueloIdExigeMinutoExacto() {
        GestorDatos d = datosAB();
        d.numVuelos = 3;
        for (int v = 0; v < 3; v++) {
            d.vueloOrigen[v] = 1; d.vueloDestino[v] = 2;
            d.vueloSalidaUTC[v] = 815 + v;
            d.vueloLlegadaUTC[v] = 1380;
            d.vueloCapacidad[v] = 150;
        }
        long dia = 20L * 1440L;
        Set<Long> claves = PlanificadorService.clavesCanceladas(
                d, List.of(new CancelacionDTO("AAAA", "BBBB", dia + 815)));
        assertEquals(Set.of(PlanificadorGVNSConcurrente.claveVueloDia(0, dia + 815)), claves);
    }

    @Test
    void clavesCanceladasTraduceDTO() {
        GestorDatos d = datosAB();
        // Ruta AAAA→BBBB con salida 10:00 → resuelve al vuelo 0 en el día de SALIDA_ABS.
        Set<Long> s = PlanificadorService.clavesCanceladas(
                d, List.of(new CancelacionDTO("AAAA", "BBBB", SALIDA_ABS)));
        assertEquals(Set.of(PlanificadorGVNSConcurrente.claveVueloDia(0, SALIDA_ABS)), s);
        assertTrue(PlanificadorService.clavesCanceladas(d, null).isEmpty());

        // Ruta inexistente → se ignora (sin validación).
        assertTrue(PlanificadorService.clavesCanceladas(
                d, List.of(new CancelacionDTO("AAAA", "ZZZZ", SALIDA_ABS))).isEmpty());
    }
}
