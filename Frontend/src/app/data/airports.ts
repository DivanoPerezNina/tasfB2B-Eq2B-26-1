import { Airport, Continent } from '../types';

// Función helper para convertir lat/long a coordenadas SVG
const latLongToSVG = (lat: number, long: number): { x: number; y: number } => {
  const x = (long + 180) * (1000 / 360);
  const y = (90 - lat) * (500 / 180);
  return { x, y };
};

export const airports: Airport[] = [
  // América del Sur
  {
    id: 'skbo',
    code: 'SKBO',
    name: 'El Dorado International',
    city: 'Bogotá',
    continent: 'America',
    coordinates: latLongToSVG(4.701389, -74.146944),
    lat: 4.701389, lng: -74.146944,
    warehouseCapacity: 430,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'seqm',
    code: 'SEQM',
    name: 'Mariscal Sucre International',
    city: 'Quito',
    continent: 'America',
    coordinates: latLongToSVG(0.113333, -78.358611),
    lat: 0.113333, lng: -78.358611,
    warehouseCapacity: 410,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'svmi',
    code: 'SVMI',
    name: 'Simón Bolívar International',
    city: 'Caracas',
    continent: 'America',
    coordinates: latLongToSVG(10.603056, -66.990556),
    lat: 10.603056, lng: -66.990556,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'sbbr',
    code: 'SBBR',
    name: 'Brasília International',
    city: 'Brasília',
    continent: 'America',
    coordinates: latLongToSVG(-15.864722, -47.918056),
    lat: -15.864722, lng: -47.918056,
    warehouseCapacity: 480,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'spim',
    code: 'SPIM',
    name: 'Jorge Chávez International',
    city: 'Lima',
    continent: 'America',
    coordinates: latLongToSVG(-12.021944, -77.114444),
    lat: -12.021944, lng: -77.114444,
    warehouseCapacity: 440,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'sllp',
    code: 'SLLP',
    name: 'El Alto International',
    city: 'La Paz',
    continent: 'America',
    coordinates: latLongToSVG(-16.513056, -68.192222),
    lat: -16.513056, lng: -68.192222,
    warehouseCapacity: 420,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'scel',
    code: 'SCEL',
    name: 'Arturo Merino Benítez International',
    city: 'Santiago de Chile',
    continent: 'America',
    coordinates: latLongToSVG(-33.396389, -70.794722),
    lat: -33.396389, lng: -70.794722,
    warehouseCapacity: 460,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'sabe',
    code: 'SABE',
    name: 'Ministro Pistarini International',
    city: 'Buenos Aires',
    continent: 'America',
    coordinates: latLongToSVG(-34.559167, -58.415556),
    lat: -34.559167, lng: -58.415556,
    warehouseCapacity: 460,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'sgas',
    code: 'SGAS',
    name: 'Silvio Pettirossi International',
    city: 'Asunción',
    continent: 'America',
    coordinates: latLongToSVG(-25.240000, -57.520000),
    lat: -25.240000, lng: -57.520000,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'suaa',
    code: 'SUAA',
    name: 'Carrasco International',
    city: 'Montevideo',
    continent: 'America',
    coordinates: latLongToSVG(-34.788611, -56.264722),
    lat: -34.788611, lng: -56.264722,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 3
  },

  // Europa
  {
    id: 'lati',
    code: 'LATI',
    name: 'Tirana International',
    city: 'Tirana',
    continent: 'Europe',
    coordinates: latLongToSVG(41.414722, 19.720556),
    lat: 41.414722, lng: 19.720556,
    warehouseCapacity: 410,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'eddi',
    code: 'EDDI',
    name: 'Berlin Brandenburg',
    city: 'Berlín',
    continent: 'Europe',
    coordinates: latLongToSVG(52.473611, 13.401667),
    lat: 52.473611, lng: 13.401667,
    warehouseCapacity: 480,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'loww',
    code: 'LOWW',
    name: 'Vienna International',
    city: 'Viena',
    continent: 'Europe',
    coordinates: latLongToSVG(48.110833, 16.570833),
    lat: 48.110833, lng: 16.570833,
    warehouseCapacity: 430,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'ebci',
    code: 'EBCI',
    name: 'Brussels Airport',
    city: 'Bruselas',
    continent: 'Europe',
    coordinates: latLongToSVG(50.459167, 4.453611),
    lat: 50.459167, lng: 4.453611,
    warehouseCapacity: 440,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'umms',
    code: 'UMMS',
    name: 'Minsk National Airport',
    city: 'Minsk',
    continent: 'Europe',
    coordinates: latLongToSVG(53.882500, 28.032500),
    lat: 53.882500, lng: 28.032500,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'lbsf',
    code: 'LBSF',
    name: 'Sofia Airport',
    city: 'Sofía',
    continent: 'Europe',
    coordinates: latLongToSVG(42.690278, 23.404722),
    lat: 42.690278, lng: 23.404722,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'lkpr',
    code: 'LKPR',
    name: 'Václav Havel Airport Prague',
    city: 'Praga',
    continent: 'Europe',
    coordinates: latLongToSVG(50.101389, 14.265556),
    lat: 50.101389, lng: 14.265556,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'ldza',
    code: 'LDZA',
    name: 'Zagreb Airport',
    city: 'Zagreb',
    continent: 'Europe',
    coordinates: latLongToSVG(45.742778, 16.068611),
    lat: 45.742778, lng: 16.068611,
    warehouseCapacity: 420,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'ekch',
    code: 'EKCH',
    name: 'Copenhagen Airport',
    city: 'Copenhague',
    continent: 'Europe',
    coordinates: latLongToSVG(55.618056, 12.656111),
    lat: 55.618056, lng: 12.656111,
    warehouseCapacity: 480,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'eham',
    code: 'EHAM',
    name: 'Amsterdam Airport Schiphol',
    city: 'Ámsterdam',
    continent: 'Europe',
    coordinates: latLongToSVG(52.300000, 4.765000),
    lat: 52.300000, lng: 4.765000,
    warehouseCapacity: 480,
    currentOccupancy: 0,
    tier: 1
  },

  // Asia
  {
    id: 'vidp',
    code: 'VIDP',
    name: 'Indira Gandhi International',
    city: 'Delhi',
    continent: 'Asia',
    coordinates: latLongToSVG(28.566389, 77.103056),
    lat: 28.566389, lng: 77.103056,
    warehouseCapacity: 480,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'osdi',
    code: 'OSDI',
    name: 'Damascus International',
    city: 'Damasco',
    continent: 'Asia',
    coordinates: latLongToSVG(33.411389, 36.515556),
    lat: 33.411389, lng: 36.515556,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'oerk',
    code: 'OERK',
    name: 'King Khalid International',
    city: 'Riad',
    continent: 'Asia',
    coordinates: latLongToSVG(24.957778, 46.698889),
    lat: 24.957778, lng: 46.698889,
    warehouseCapacity: 420,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'omdb',
    code: 'OMDB',
    name: 'Dubai International',
    city: 'Dubai',
    continent: 'Asia',
    coordinates: latLongToSVG(25.252778, 55.364444),
    lat: 25.252778, lng: 55.364444,
    warehouseCapacity: 420,
    currentOccupancy: 0,
    tier: 1
  },
  {
    id: 'oakb',
    code: 'OAKB',
    name: 'Hamid Karzai International',
    city: 'Kabul',
    continent: 'Asia',
    coordinates: latLongToSVG(34.565556, 69.211111),
    lat: 34.565556, lng: 69.211111,
    warehouseCapacity: 480,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'ooms',
    code: 'OOMS',
    name: 'Muscat International',
    city: 'Mascate',
    continent: 'Asia',
    coordinates: latLongToSVG(23.589444, 58.284167),
    lat: 23.589444, lng: 58.284167,
    warehouseCapacity: 460,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'oysn',
    code: 'OYSN',
    name: 'Sana\'a International',
    city: 'Saná',
    continent: 'Asia',
    coordinates: latLongToSVG(15.476111, 44.219722),
    lat: 15.476111, lng: 44.219722,
    warehouseCapacity: 420,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'opkc',
    code: 'OPKC',
    name: 'Jinnah International',
    city: 'Karachi',
    continent: 'Asia',
    coordinates: latLongToSVG(24.900000, 67.150000),
    lat: 24.900000, lng: 67.150000,
    warehouseCapacity: 410,
    currentOccupancy: 0,
    tier: 2
  },
  {
    id: 'ubbb',
    code: 'UBBB',
    name: 'Heydar Aliyev International',
    city: 'Bakú',
    continent: 'Asia',
    coordinates: latLongToSVG(40.467222, 50.046667),
    lat: 40.467222, lng: 50.046667,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 3
  },
  {
    id: 'ojai',
    code: 'OJAI',
    name: 'Queen Alia International',
    city: 'Amán',
    continent: 'Asia',
    coordinates: latLongToSVG(31.722500, 35.993333),
    lat: 31.722500, lng: 35.993333,
    warehouseCapacity: 400,
    currentOccupancy: 0,
    tier: 3
  }
];

export const getAirportById = (id: string): Airport | undefined => {
  return airports.find(airport => airport.id === id);
};

export const getAirportsByContinent = (continent: Continent): Airport[] => {
  return airports.filter(airport => airport.continent === continent);
};

export const calculateDistance = (airport1: Airport, airport2: Airport): number => {
  const dx = airport2.coordinates.x - airport1.coordinates.x;
  const dy = airport2.coordinates.y - airport1.coordinates.y;
  return Math.sqrt(dx * dx + dy * dy);
};