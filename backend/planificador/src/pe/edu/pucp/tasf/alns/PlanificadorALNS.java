package pe.edu.pucp.tasf.alns;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public class PlanificadorALNS {
    private ActiveShipmentPool pool;
    private RouteStore routes;
    private FlightCapacityStore flights;
    private AirportCapacityTimeline airports;
    private final Random rand;

    // Pesos para operadores
    private double[] destroyWeights = {1,1,1,1,1};
    private double[] repairWeights = {1,1,1,1};
    private int[] destroyUses = {0,0,0,0,0};
    private int[] repairUses = {0,0,0,0};
    private double[] destroyScores = {0,0,0,0,0};
    private double[] repairScores = {0,0,0,0};

    /** Constructor reproducible: pasa una semilla fija para experimentos. */
    public PlanificadorALNS(ActiveShipmentPool p, RouteStore r, FlightCapacityStore f,
                             AirportCapacityTimeline a, long seed) {
        pool = p; routes = r; flights = f; airports = a;
        rand = new Random(seed);
    }

    /** Constructor sin semilla (modo normal del compañero — no determinista). */
    public PlanificadorALNS(ActiveShipmentPool p, RouteStore r, FlightCapacityStore f, AirportCapacityTimeline a) {
        this(p, r, f, a, System.currentTimeMillis());
    }

    public ResultadoALNS ejecutarALNS(List<Integer> criticos, long timeLimitMs) {
        return ejecutarALNS(criticos, timeLimitMs, ConfigExperimentacion.MAX_ITERACIONES_ALNS);
    }

    public ResultadoALNS ejecutarALNS(List<Integer> criticos, long timeLimitMs, int maxIteraciones) {
        ResultadoALNS resultado = new ResultadoALNS();
        if (criticos == null || criticos.isEmpty()) {
            resultado.llamadasALNS = 0;
            resultado.iteraciones = 0;
            resultado.criticosAntes = 0;
            resultado.criticosDespues = 0;
            resultado.sinRutaAntes = 0;
            resultado.sinRutaDespues = 0;
            resultado.pendientesAntes = 0;
            resultado.pendientesDespues = 0;
            resultado.reparados = 0;
            resultado.empeorados = 0;
            resultado.fitnessAntesALNS = EvaluadorSolucion.calcularFitness(pool, routes, 0);
            resultado.fitnessDespuesALNS = resultado.fitnessAntesALNS;
            resultado.mejoro = false;
            return resultado;
        }

        resultado.llamadasALNS = 1;
        resultado.sinRutaAntes = 0;
        resultado.pendientesAntes = 0;
        resultado.retrasadosAntes = 0;
        for (int idx : criticos) {
            int status = pool.getStatus(idx);
            if (status == ActiveShipmentPool.SIN_RUTA) {
                resultado.sinRutaAntes++;
            } else if (status == ActiveShipmentPool.PENDIENTE || status == ActiveShipmentPool.EN_ALMACEN || status == ActiveShipmentPool.PLANIFICADO) {
                resultado.pendientesAntes++;
            } else if (status == ActiveShipmentPool.RETRASADO) {
                resultado.retrasadosAntes++;
            }
        }
        resultado.criticosAntes = resultado.sinRutaAntes + resultado.pendientesAntes + resultado.retrasadosAntes;
        resultado.fitnessAntesALNS = EvaluadorSolucion.calcularFitness(pool, routes, 0);
        resultado.convergencia = new ArrayList<>();

        long start = System.currentTimeMillis();
        double bestFitness = resultado.fitnessAntesALNS;
        int iter = 0;
        while (System.currentTimeMillis() - start < timeLimitMs && iter < maxIteraciones) {
            OperadorDestroy destroy = seleccionarDestroy();
            OperadorRepair repair = seleccionarRepair();
            List<Integer> removidos = destroyOperacion(destroy, criticos);
            for (int idx : removidos) {
                liberarReservas(idx);
                routes.clearRoute(idx);
                pool.setStatus(idx, ActiveShipmentPool.SIN_RUTA);
            }
            for (int idx : removidos) {
                planificarRutaInicial(idx, repair);
            }
            double fitness = EvaluadorSolucion.calcularFitness(pool, routes, 0);
            if (fitness < bestFitness) {
                bestFitness = fitness;
                actualizarPesos(destroy, repair, 10);
            } else {
                actualizarPesos(destroy, repair, -1);
            }
            long msActual = System.currentTimeMillis() - start;
            resultado.convergencia.add(new long[]{iter + 1, msActual, (long) bestFitness});
            iter++;
        }

        resultado.iteraciones = iter;
        resultado.fitnessDespuesALNS = EvaluadorSolucion.calcularFitness(pool, routes, 0);
        resultado.sinRutaDespues = 0;
        resultado.pendientesDespues = 0;
        resultado.retrasadosDespues = 0;
        for (int i = 0; i < pool.getSize(); i++) {
            int status = pool.getStatus(i);
            if (status == ActiveShipmentPool.SIN_RUTA) {
                resultado.sinRutaDespues++;
            } else if (status == ActiveShipmentPool.PENDIENTE || status == ActiveShipmentPool.EN_ALMACEN || status == ActiveShipmentPool.PLANIFICADO) {
                resultado.pendientesDespues++;
            } else if (status == ActiveShipmentPool.RETRASADO) {
                resultado.retrasadosDespues++;
            }
        }
        resultado.criticosDespues = resultado.sinRutaDespues + resultado.pendientesDespues + resultado.retrasadosDespues;
        resultado.reparados = Math.max(0, resultado.criticosAntes - resultado.criticosDespues);
        resultado.empeorados = Math.max(0, resultado.criticosDespues - resultado.criticosAntes);
        resultado.mejoro = resultado.fitnessDespuesALNS < resultado.fitnessAntesALNS;
        return resultado;
    }

    private OperadorDestroy seleccionarDestroy() {
        double total = 0;
        for (double w : destroyWeights) total += w;
        double r = rand.nextDouble() * total;
        double cum = 0;
        for (int i = 0; i < destroyWeights.length; i++) {
            cum += destroyWeights[i];
            if (r <= cum) return OperadorDestroy.values()[i];
        }
        return OperadorDestroy.RANDOM_REMOVAL;
    }

    private OperadorRepair seleccionarRepair() {
        double total = 0;
        for (double w : repairWeights) total += w;
        double r = rand.nextDouble() * total;
        double cum = 0;
        for (int i = 0; i < repairWeights.length; i++) {
            cum += repairWeights[i];
            if (r <= cum) return OperadorRepair.values()[i];
        }
        return OperadorRepair.EARLIEST_ARRIVAL_INSERTION;
    }

    private List<Integer> destroyOperacion(OperadorDestroy op, List<Integer> criticos) {
        // Implementar lógica de destroy, ej random
        List<Integer> removidos = new ArrayList<>();
        int num = Math.min(10, criticos.size());
        for (int i = 0; i < num; i++) {
            removidos.add(criticos.get(rand.nextInt(criticos.size())));
        }
        return removidos;
    }

    private void liberarReservas(int idx) {
        int length = routes.getRouteLength(idx);
        if (length <= 0) {
            return;
        }

        int qty = pool.getQuantity(idx);
        int currentAirport = pool.getOrigin(idx);
        long currentTime = pool.getReleaseUTC(idx);

        for (int hop = 0; hop < length; hop++) {
            int flightId = routes.getFlightId(idx, hop);
            long depUTC = routes.getDepartureUTC(idx, hop);

            airports.releaseInterval(currentAirport, currentTime, depUTC, qty);
            flights.release(flightId, depUTC, qty);

            long dur = DatosEstaticos.flightArrivalUTCMinuteOfDay[flightId]
                    - DatosEstaticos.flightDepartureUTCMinuteOfDay[flightId];
            if (dur < 0) dur += 1440;
            long arrUTC = depUTC + dur;

            currentAirport = DatosEstaticos.flightDestination[flightId];
            currentTime = arrUTC;
        }
    }

    private boolean planificarRutaInicial(int idx, OperadorRepair repair) {
        int orig = pool.getOrigin(idx);
        int dest = pool.getDestination(idx);
        int qty = pool.getQuantity(idx);
        long release = pool.getReleaseUTC(idx);
        long deadline = pool.getDeadlineUTC(idx);
        int maxHops = ConfigExperimentacion.MAX_SALTOS;

        boolean foundCandidate = false;
        boolean foundFeasible = false;
        int bestLen = 0;
        int[] bestFlights = null;
        long[] bestDeps = null;
        long bestArrival = 0L;
        double bestScore = 0.0;

        // Nivel 1: directo
        for (int f = 0; f < DatosEstaticos.numFlights; f++) {
            if (DatosEstaticos.flightOrigin[f] != orig || DatosEstaticos.flightDestination[f] != dest) continue;
            foundCandidate = true;

            long minDay = release / 1440;
            long minOfDay = release % 1440;
            long dep1 = (minOfDay <= DatosEstaticos.flightDepartureUTCMinuteOfDay[f])
                    ? minDay * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f]
                    : (minDay + 1) * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f];
            long dur1 = DatosEstaticos.flightArrivalUTCMinuteOfDay[f] - DatosEstaticos.flightDepartureUTCMinuteOfDay[f];
            if (dur1 < 0) dur1 += 1440;
            long arr1 = dep1 + dur1;

            if (!airports.canReserveInterval(orig, release, dep1, qty)) continue;
            if (!flights.canReserve(f, dep1, qty)) continue;

            int cap1 = DatosEstaticos.flightCapacity[f];
            double ratio1 = (double) qty / Math.max(1, cap1);
            double sumRatio = ratio1;
            double maxRatio = ratio1;
            double slack = (double) (deadline - arr1);

            double score;
            switch (repair) {
                case BEST_SLACK_INSERTION:
                    score = -slack;
                    break;
                case LEAST_CONGESTED_INSERTION:
                    score = maxRatio;
                    break;
                case MIN_CAPACITY_IMPACT_INSERTION:
                    score = sumRatio;
                    break;
                case EARLIEST_ARRIVAL_INSERTION:
                default:
                    score = (double) arr1;
                    break;
            }

            if (!foundFeasible || score < bestScore || (score == bestScore && arr1 < bestArrival)) {
                foundFeasible = true;
                bestScore = score;
                bestArrival = arr1;
                bestLen = 1;
                bestFlights = new int[]{f};
                bestDeps = new long[]{dep1};
            }
        }

        // Nivel 2: 1 escala
        if (maxHops >= 2) {
            for (int f1 = 0; f1 < DatosEstaticos.numFlights; f1++) {
                if (DatosEstaticos.flightOrigin[f1] != orig) continue;
                int mid1 = DatosEstaticos.flightDestination[f1];
                if (mid1 == dest || mid1 == orig) continue;

                long day1 = release / 1440;
                long minDay1 = release % 1440;
                long dep1 = (minDay1 <= DatosEstaticos.flightDepartureUTCMinuteOfDay[f1])
                        ? day1 * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f1]
                        : (day1 + 1) * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f1];
                long dur1 = DatosEstaticos.flightArrivalUTCMinuteOfDay[f1] - DatosEstaticos.flightDepartureUTCMinuteOfDay[f1];
                if (dur1 < 0) dur1 += 1440;
                long arr1 = dep1 + dur1;

                for (int f2 = 0; f2 < DatosEstaticos.numFlights; f2++) {
                    if (DatosEstaticos.flightOrigin[f2] != mid1 || DatosEstaticos.flightDestination[f2] != dest) continue;
                    foundCandidate = true;

                    long earliest2 = arr1 + ConfigExperimentacion.TIEMPO_MINIMO_ESCALA_MINUTOS;
                    long day2 = earliest2 / 1440;
                    long minDay2 = earliest2 % 1440;
                    long dep2 = (minDay2 <= DatosEstaticos.flightDepartureUTCMinuteOfDay[f2])
                            ? day2 * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f2]
                            : (day2 + 1) * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f2];
                    long dur2 = DatosEstaticos.flightArrivalUTCMinuteOfDay[f2] - DatosEstaticos.flightDepartureUTCMinuteOfDay[f2];
                    if (dur2 < 0) dur2 += 1440;
                    long arr2 = dep2 + dur2;

                    if (!airports.canReserveInterval(orig, release, dep1, qty)) continue;
                    if (!flights.canReserve(f1, dep1, qty)) continue;
                    if (!airports.canReserveInterval(mid1, arr1, dep2, qty)) continue;
                    if (!flights.canReserve(f2, dep2, qty)) continue;

                    int cap1 = DatosEstaticos.flightCapacity[f1];
                    int cap2 = DatosEstaticos.flightCapacity[f2];
                    double ratio1 = (double) qty / Math.max(1, cap1);
                    double ratio2 = (double) qty / Math.max(1, cap2);
                    double sumRatio = ratio1 + ratio2;
                    double maxRatio = Math.max(ratio1, ratio2);
                    double slack = (double) (deadline - arr2);

                    double score;
                    switch (repair) {
                        case BEST_SLACK_INSERTION:
                            score = -slack;
                            break;
                        case LEAST_CONGESTED_INSERTION:
                            score = maxRatio;
                            break;
                        case MIN_CAPACITY_IMPACT_INSERTION:
                            score = sumRatio;
                            break;
                        case EARLIEST_ARRIVAL_INSERTION:
                        default:
                            score = (double) arr2;
                            break;
                    }

                    if (!foundFeasible || score < bestScore || (score == bestScore && arr2 < bestArrival)) {
                        foundFeasible = true;
                        bestScore = score;
                        bestArrival = arr2;
                        bestLen = 2;
                        bestFlights = new int[]{f1, f2};
                        bestDeps = new long[]{dep1, dep2};
                    }
                }
            }
        }

        // Nivel 3: 2 escalas
        if (maxHops >= 3) {
            for (int f1 = 0; f1 < DatosEstaticos.numFlights; f1++) {
                if (DatosEstaticos.flightOrigin[f1] != orig) continue;
                int mid1 = DatosEstaticos.flightDestination[f1];
                if (mid1 == dest || mid1 == orig) continue;

                long day1 = release / 1440;
                long minDay1 = release % 1440;
                long dep1 = (minDay1 <= DatosEstaticos.flightDepartureUTCMinuteOfDay[f1])
                        ? day1 * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f1]
                        : (day1 + 1) * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f1];
                long dur1 = DatosEstaticos.flightArrivalUTCMinuteOfDay[f1] - DatosEstaticos.flightDepartureUTCMinuteOfDay[f1];
                if (dur1 < 0) dur1 += 1440;
                long arr1 = dep1 + dur1;

                for (int f2 = 0; f2 < DatosEstaticos.numFlights; f2++) {
                    if (DatosEstaticos.flightOrigin[f2] != mid1) continue;
                    int mid2 = DatosEstaticos.flightDestination[f2];
                    if (mid2 == dest || mid2 == orig || mid2 == mid1) continue;

                    long earliest2 = arr1 + ConfigExperimentacion.TIEMPO_MINIMO_ESCALA_MINUTOS;
                    long day2 = earliest2 / 1440;
                    long minDay2 = earliest2 % 1440;
                    long dep2 = (minDay2 <= DatosEstaticos.flightDepartureUTCMinuteOfDay[f2])
                            ? day2 * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f2]
                            : (day2 + 1) * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f2];
                    long dur2 = DatosEstaticos.flightArrivalUTCMinuteOfDay[f2] - DatosEstaticos.flightDepartureUTCMinuteOfDay[f2];
                    if (dur2 < 0) dur2 += 1440;
                    long arr2 = dep2 + dur2;

                    for (int f3 = 0; f3 < DatosEstaticos.numFlights; f3++) {
                        if (DatosEstaticos.flightOrigin[f3] != mid2 || DatosEstaticos.flightDestination[f3] != dest) continue;
                        foundCandidate = true;

                        long earliest3 = arr2 + ConfigExperimentacion.TIEMPO_MINIMO_ESCALA_MINUTOS;
                        long day3 = earliest3 / 1440;
                        long minDay3 = earliest3 % 1440;
                        long dep3 = (minDay3 <= DatosEstaticos.flightDepartureUTCMinuteOfDay[f3])
                                ? day3 * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f3]
                                : (day3 + 1) * 1440 + DatosEstaticos.flightDepartureUTCMinuteOfDay[f3];
                        long dur3 = DatosEstaticos.flightArrivalUTCMinuteOfDay[f3] - DatosEstaticos.flightDepartureUTCMinuteOfDay[f3];
                        if (dur3 < 0) dur3 += 1440;
                        long arr3 = dep3 + dur3;

                        if (!airports.canReserveInterval(orig, release, dep1, qty)) continue;
                        if (!flights.canReserve(f1, dep1, qty)) continue;
                        if (!airports.canReserveInterval(mid1, arr1, dep2, qty)) continue;
                        if (!flights.canReserve(f2, dep2, qty)) continue;
                        if (!airports.canReserveInterval(mid2, arr2, dep3, qty)) continue;
                        if (!flights.canReserve(f3, dep3, qty)) continue;

                        int cap1 = DatosEstaticos.flightCapacity[f1];
                        int cap2 = DatosEstaticos.flightCapacity[f2];
                        int cap3 = DatosEstaticos.flightCapacity[f3];
                        double ratio1 = (double) qty / Math.max(1, cap1);
                        double ratio2 = (double) qty / Math.max(1, cap2);
                        double ratio3 = (double) qty / Math.max(1, cap3);
                        double sumRatio = ratio1 + ratio2 + ratio3;
                        double maxRatio = Math.max(ratio1, Math.max(ratio2, ratio3));
                        double slack = (double) (deadline - arr3);

                        double score;
                        switch (repair) {
                            case BEST_SLACK_INSERTION:
                                score = -slack;
                                break;
                            case LEAST_CONGESTED_INSERTION:
                                score = maxRatio;
                                break;
                            case MIN_CAPACITY_IMPACT_INSERTION:
                                score = sumRatio;
                                break;
                            case EARLIEST_ARRIVAL_INSERTION:
                            default:
                                score = (double) arr3;
                                break;
                        }

                        if (!foundFeasible || score < bestScore || (score == bestScore && arr3 < bestArrival)) {
                            foundFeasible = true;
                            bestScore = score;
                            bestArrival = arr3;
                            bestLen = 3;
                            bestFlights = new int[]{f1, f2, f3};
                            bestDeps = new long[]{dep1, dep2, dep3};
                        }
                    }
                }
            }
        }

        if (!foundFeasible) {
            if (foundCandidate) {
                pool.setStatus(idx, ActiveShipmentPool.NO_FACTIBLE_ESTRUCTURAL);
            } else {
                pool.setStatus(idx, ActiveShipmentPool.SIN_RUTA);
            }
            return false;
        }

        int currentAirport = orig;
        long currentTime = release;
        for (int hop = 0; hop < bestLen; hop++) {
            int flightId = bestFlights[hop];
            long depUTC = bestDeps[hop];
            airports.reserveInterval(currentAirport, currentTime, depUTC, qty);
            flights.reserve(flightId, depUTC, qty);
            long dur = DatosEstaticos.flightArrivalUTCMinuteOfDay[flightId]
                    - DatosEstaticos.flightDepartureUTCMinuteOfDay[flightId];
            if (dur < 0) dur += 1440;
            long arrUTC = depUTC + dur;
            currentAirport = DatosEstaticos.flightDestination[flightId];
            currentTime = arrUTC;
        }

        int start = routes.allocateRoute(bestLen);
        routes.setRoute(idx, start, bestLen, bestFlights, bestDeps);
        if (currentTime <= deadline) {
            pool.setStatus(idx, ActiveShipmentPool.ENTREGADO);
        } else {
            pool.setStatus(idx, ActiveShipmentPool.RETRASADO);
        }
        return true;
    }

    private void actualizarPesos(OperadorDestroy d, OperadorRepair r, int score) {
        int di = d.ordinal();
        int ri = r.ordinal();
        destroyUses[di]++;
        repairUses[ri]++;
        destroyScores[di] += score;
        repairScores[ri] += score;
        destroyWeights[di] = Math.max(0.1, destroyScores[di] / destroyUses[di]);
        repairWeights[ri] = Math.max(0.1, repairScores[ri] / repairUses[ri]);
    }
}