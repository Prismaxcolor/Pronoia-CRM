import { crearBdFalsa } from './bd-falsa.js';

/** Instancia única por archivo de prueba (vitest aísla los módulos por archivo). */
export const bdFalsa = crearBdFalsa();
