import { z } from 'zod';
import { MENSAJE_MAXIMO_DOS_DECIMALES, tieneMaximoDosDecimales } from '../utils/importe-centavos.js';

/** Tope razonable de un pago o cobro en USD: por encima casi seguro es un error de tecleo (un cero de más). */
export const MONTO_MAXIMO_USD = 10_000_000;
/** Tope del monto en la moneda de la cuenta (Bs incluido): MONTO_MAXIMO_USD a una tasa holgada de 1.000 Bs por USD. */
export const MONTO_MAXIMO_MONEDA_CUENTA = MONTO_MAXIMO_USD * 1_000;

const mensajeMaximo = (tope: number, unidad: string): string =>
  `El monto no puede superar ${tope.toLocaleString('es-VE')} ${unidad}.`;

/** Monto > 0 en la moneda de la cuenta: tope y máximo 2 decimales. */
export const montoCuentaSchema = z
  .number()
  .positive('El monto debe ser mayor a 0.')
  .max(MONTO_MAXIMO_MONEDA_CUENTA, mensajeMaximo(MONTO_MAXIMO_MONEDA_CUENTA, 'en la moneda de la cuenta'))
  .refine(tieneMaximoDosDecimales, MENSAJE_MAXIMO_DOS_DECIMALES);

/** Monto > 0 en USD: tope y máximo 2 decimales. */
export const montoUsdPositivoSchema = z
  .number()
  .positive('El monto en USD debe ser mayor a 0.')
  .max(MONTO_MAXIMO_USD, mensajeMaximo(MONTO_MAXIMO_USD, 'USD'))
  .refine(tieneMaximoDosDecimales, MENSAJE_MAXIMO_DOS_DECIMALES);

/** Total en USD >= 0 (0 = cruce puro): tope y máximo 2 decimales. */
export const montoUsdTotalSchema = z
  .number()
  .min(0, 'El monto en USD no puede ser negativo.')
  .max(MONTO_MAXIMO_USD, mensajeMaximo(MONTO_MAXIMO_USD, 'USD'))
  .refine(tieneMaximoDosDecimales, MENSAJE_MAXIMO_DOS_DECIMALES);
