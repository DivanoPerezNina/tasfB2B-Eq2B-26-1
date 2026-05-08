import { Aeropuerto } from '../types';

// Aeropuertos en formato backend (30 aeropuertos)
export const aeropuertosBackend: Aeropuerto[] = [
  { id: 1,  iata: 'SKBO', continente: 1, gmt: -5, capacidadAlmacen: 430 },
  { id: 2,  iata: 'SEQM', continente: 1, gmt: -5, capacidadAlmacen: 410 },
  { id: 3,  iata: 'SVMI', continente: 1, gmt: -4, capacidadAlmacen: 400 },
  { id: 4,  iata: 'SBBR', continente: 1, gmt: -3, capacidadAlmacen: 480 },
  { id: 5,  iata: 'SPIM', continente: 1, gmt: -5, capacidadAlmacen: 440 },
  { id: 6,  iata: 'SLLP', continente: 1, gmt: -4, capacidadAlmacen: 420 },
  { id: 7,  iata: 'SCEL', continente: 1, gmt: -3, capacidadAlmacen: 460 },
  { id: 8,  iata: 'SABE', continente: 1, gmt: -3, capacidadAlmacen: 460 },
  { id: 9,  iata: 'SGAS', continente: 1, gmt: -4, capacidadAlmacen: 400 },
  { id: 10, iata: 'SUAA', continente: 1, gmt: -3, capacidadAlmacen: 400 },
  { id: 11, iata: 'LATI', continente: 2, gmt: 2,  capacidadAlmacen: 410 },
  { id: 12, iata: 'EDDI', continente: 2, gmt: 2,  capacidadAlmacen: 480 },
  { id: 13, iata: 'LOWW', continente: 2, gmt: 2,  capacidadAlmacen: 430 },
  { id: 14, iata: 'EBCI', continente: 2, gmt: 2,  capacidadAlmacen: 440 },
  { id: 15, iata: 'UMMS', continente: 2, gmt: 3,  capacidadAlmacen: 400 },
  { id: 16, iata: 'LBSF', continente: 2, gmt: 3,  capacidadAlmacen: 400 },
  { id: 17, iata: 'LKPR', continente: 2, gmt: 2,  capacidadAlmacen: 400 },
  { id: 18, iata: 'LDZA', continente: 2, gmt: 2,  capacidadAlmacen: 420 },
  { id: 19, iata: 'EKCH', continente: 2, gmt: 2,  capacidadAlmacen: 480 },
  { id: 20, iata: 'EHAM', continente: 2, gmt: 2,  capacidadAlmacen: 480 },
  { id: 21, iata: 'VIDP', continente: 3, gmt: 5,  capacidadAlmacen: 480 },
  { id: 22, iata: 'OSDI', continente: 3, gmt: 3,  capacidadAlmacen: 400 },
  { id: 23, iata: 'OERK', continente: 3, gmt: 3,  capacidadAlmacen: 420 },
  { id: 24, iata: 'OMDB', continente: 3, gmt: 4,  capacidadAlmacen: 420 },
  { id: 25, iata: 'OAKB', continente: 3, gmt: 4,  capacidadAlmacen: 480 },
  { id: 26, iata: 'OOMS', continente: 3, gmt: 4,  capacidadAlmacen: 460 },
  { id: 27, iata: 'OYSN', continente: 3, gmt: 3,  capacidadAlmacen: 420 },
  { id: 28, iata: 'OPKC', continente: 3, gmt: 5,  capacidadAlmacen: 410 },
  { id: 29, iata: 'UBBB', continente: 3, gmt: 2,  capacidadAlmacen: 400 },
  { id: 30, iata: 'OJAI', continente: 3, gmt: 3,  capacidadAlmacen: 400 },
];

export function getAeropuertoById(id: number): Aeropuerto | undefined {
  return aeropuertosBackend.find(a => a.id === id);
}

export function getAeropuertoByIata(iata: string): Aeropuerto | undefined {
  return aeropuertosBackend.find(a => a.iata.toUpperCase() === iata.toUpperCase());
}
