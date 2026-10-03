/** Frases de BLOB y selección por pantalla. Lógica pura y testeable. */

export type PaginaBlob =
  | 'inicio' | 'metricas' | 'pesaje' | 'compras' | 'ventas' | 'inventario' | 'transformaciones'
  | 'productos' | 'listas-precios' | 'taras' | 'vehiculos' | 'clientes' | 'proveedores'
  | 'cochinito' | 'usuarios' | 'citas' | 'otra';

export type ContextoFrase = 'inactivo' | 'cambio-ruta' | 'saludo';
export type Frecuencia = 'nunca' | 'baja' | 'media' | 'alta';

const RUTAS: Array<[prefijo: string, pagina: PaginaBlob]> = [
  ['/metricas', 'metricas'],
  ['/pesaje', 'pesaje'],
  ['/compras', 'compras'],
  ['/ventas', 'ventas'],
  ['/inventario', 'inventario'],
  ['/transformaciones', 'transformaciones'],
  ['/productos', 'productos'],
  ['/listas-precios', 'listas-precios'],
  ['/taras', 'taras'],
  ['/vehiculos', 'vehiculos'],
  ['/clientes', 'clientes'],
  ['/proveedores', 'proveedores'],
  ['/cochinito', 'cochinito'],
  ['/usuarios', 'usuarios'],
  ['/citas', 'citas'],
];

export function paginaDesdeRuta(pathname: string): PaginaBlob {
  if (pathname === '/' || pathname === '') return 'inicio';
  const hit = RUTAS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : 'otra';
}

export const FRASES_GENERALES: string[] = [
  '¿Todo bien por ahí?',
  'Estoy aquí abajo, por si me necesitas.',
  'Tócame, no muerdo. No tengo dientes.',
  'Hoy huele a metal reciclado.',
  'Soy 90% gelatina y 10% ganas de ayudar.',
  'Si hay un error, la culpa es del cable.',
  '¿Un break? Los blobs no necesitamos, pero tú sí.',
  'Rebotar es mi cardio.',
];

export const FRASES_POR_PAGINA: Partial<Record<PaginaBlob, string[]>> = {
  inicio: ['¡Buenas! Hoy es un gran día para pesar cosas.', 'Tablero a la vista, ¡a trabajar!'],
  metricas: ['Los números hoy se ven... numéricos.', 'Gráficas bonitas, ¿eh?'],
  pesaje: ['¡Qué buen peso!', 'Mira esa báscula, qué elegante.', 'Recuerda restar la tara. O no, tú sabrás.'],
  compras: ['Comprando se hace empresa.', 'Revisa bien los precios antes de guardar.'],
  ventas: ['¡Una venta más para la colección!', 'Vender es el arte de soltar kilos.'],
  inventario: ['Inventario: el arte de contar cosas pesadas.', '¿Seguro que ese lote no se escapó?'],
  transformaciones: ['Transformar es mi segunda profesión.', 'De chatarra a tesoro, paso a paso.'],
  productos: ['Mucho catálogo por aquí.', 'Cobre, aluminio, bronce... qué gusto.'],
  'listas-precios': ['Los precios suben y bajan; yo solo rebote.'],
  taras: ['La tara: ese peso que nadie quiere pero todos restan.'],
  vehiculos: ['¡Camiones! Me encantan los camiones.', 'Placas, placas, placas.'],
  clientes: ['Cliente contento, blob contento.'],
  proveedores: ['Sin proveedores no hay chatarra. ¡Gracias, proveedores!'],
  cochinito: ['Cuidando el cochinito, oink.', 'Cada moneda cuenta.'],
  usuarios: ['Con gran poder viene gran responsabilidad.'],
  citas: ['Puntualidad ante todo, ¡los camiones esperan!'],
};

export const FRASES_SALUDO: string[] = ['¡Hola!', '¡Aquí estoy!', '¡A trabajar!'];

export const MAX_FRASES_PROPIAS = 20;
export const MAX_LONGITUD_FRASE = 80;

interface OpcionesFrase {
  pagina: PaginaBlob;
  contexto: ContextoFrase;
  propias?: string[];
  aleatorio?: () => number;
}

function elegir<T>(lista: T[], aleatorio: () => number): T {
  const idx = Math.min(lista.length - 1, Math.floor(aleatorio() * lista.length));
  return lista[idx]!;
}

/**
 * - saludo: frases de saludo.
 * - cambio-ruta: prioriza las de la pantalla (si hay) más las propias.
 * - inactivo: mezcla generales + pantalla + propias.
 */
export function elegirFrase({ pagina, contexto, propias = [], aleatorio = Math.random }: OpcionesFrase): string {
  if (contexto === 'saludo') return elegir(FRASES_SALUDO, aleatorio);
  const deRuta = FRASES_POR_PAGINA[pagina] ?? [];
  const pool =
    contexto === 'cambio-ruta'
      ? [...(deRuta.length ? deRuta : FRASES_GENERALES), ...propias]
      : [...FRASES_GENERALES, ...deRuta, ...propias];
  return elegir(pool, aleatorio);
}

/** Rango de espera entre frases espontáneas por frecuencia; null = nunca. */
export function intervaloFrases(frecuencia: Frecuencia, aleatorio: () => number = Math.random): number | null {
  const rangos: Record<Exclude<Frecuencia, 'nunca'>, [number, number]> = {
    baja: [120_000, 240_000],
    media: [45_000, 90_000],
    alta: [15_000, 40_000],
  };
  if (frecuencia === 'nunca') return null;
  const [min, max] = rangos[frecuencia];
  return Math.round(min + aleatorio() * (max - min));
}

/** Probabilidad de comentar al cambiar de pantalla, según frecuencia. */
export function probabilidadCambioRuta(frecuencia: Frecuencia): number {
  return { nunca: 0, baja: 0.15, media: 0.35, alta: 0.7 }[frecuencia];
}

/** Exclamaciones al ser tocado seguido (clave = ánimo resultante). */
export const FRASES_REACCION: Record<string, string[]> = {
  risa: ['¡Jajaja, cosquillas!', '¡Jiji! Otra vez.'],
  enojado: ['¡Oye, ya basta!', '¡Que me despeinas!'],
  mareado: ['Uy... todo da vueltas...', 'Me mareé, me mareé...'],
  sorprendido: ['¡Ah! ¿Qué?'],
};

export function fraseDeReaccion(animo: string, aleatorio: () => number = Math.random): string | null {
  const lista = FRASES_REACCION[animo];
  return lista ? elegir(lista, aleatorio) : null;
}
