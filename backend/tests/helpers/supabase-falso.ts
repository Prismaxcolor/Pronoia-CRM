/**
 * Doble de supabaseAdmin para probar los envíos por Telegram sin BD real.
 * Las tablas se llenan con filas planas; eq/in filtran de verdad (así se verifica que el
 * chat_id que sale es el de la entidad correcta), el resto de filtros se ignoran.
 * select('...') devuelve la fila completa, con los joins ya embebidos en el fixture.
 */
type Fila = Record<string, unknown>;

export interface SubidaFalsa {
  bucket: string;
  ruta: string;
  contentType: string | undefined;
}

export interface EstadoSupabaseFalso {
  tablas: Record<string, Fila[]>;
  /** Respuesta de cada rpc: valor fijo o función de los argumentos. */
  rpc: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;
  subidas: SubidaFalsa[];
  errorSubida: { message: string } | null;
  errorFirma: { message: string } | null;
  /** Si una tabla está aquí, from(tabla) lanza (simula caída de la BD). */
  tablaQueLanza: string | null;
  updates: Array<{ tabla: string; valores: Fila }>;
}

export const estado: EstadoSupabaseFalso = {
  tablas: {},
  rpc: {},
  subidas: [],
  errorSubida: null,
  errorFirma: null,
  tablaQueLanza: null,
  updates: [],
};

export function reiniciarSupabaseFalso(): void {
  estado.tablas = {};
  estado.rpc = {};
  estado.subidas = [];
  estado.errorSubida = null;
  estado.errorFirma = null;
  estado.tablaQueLanza = null;
  estado.updates = [];
}

function consulta(tabla: string) {
  if (estado.tablaQueLanza === tabla) throw new Error(`BD caída (${tabla})`);
  const filtros: Array<(f: Fila) => boolean> = [];
  let cambios: Fila | null = null;
  const filas = () => {
    const encontradas = (estado.tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)));
    // update(...) aplica de verdad el cambio al ejecutarse (como la BD), una sola vez.
    if (cambios) { for (const f of encontradas) Object.assign(f, cambios); cambios = null; }
    return encontradas;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: () => b,
    eq: (col: string, valor: unknown) => { filtros.push(f => f[col] === valor); return b; },
    in: (col: string, valores: unknown[]) => { filtros.push(f => valores.includes(f[col])); return b; },
    neq: () => b, not: () => b, or: () => b, is: () => b, gte: () => b, lte: () => b, order: () => b, limit: () => b,
    update: (valores: Fila) => { estado.updates.push({ tabla, valores }); cambios = valores; return b; },
    insert: () => b,
    maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
    single: async () => ({ data: filas()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: filas(), error: null, count: filas().length }).then(res, rej),
  };
  return b;
}

export const supabaseAdminFalso = {
  from: (tabla: string) => consulta(tabla),
  rpc: async (nombre: string, args: Record<string, unknown>) => {
    const r = estado.rpc[nombre];
    if (r === undefined) return { data: null, error: { message: `rpc ${nombre} no simulada` } };
    return { data: typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r, error: null };
  },
  storage: {
    from: (bucket: string) => ({
      upload: async (ruta: string, _buffer: Buffer, opts?: { contentType?: string }) => {
        if (estado.errorSubida) return { data: null, error: estado.errorSubida };
        estado.subidas.push({ bucket, ruta, contentType: opts?.contentType });
        return { data: { path: ruta }, error: null };
      },
      createSignedUrl: async (ruta: string) => {
        if (estado.errorFirma) return { data: null, error: estado.errorFirma };
        return { data: { signedUrl: `https://storage.test/firmada/${ruta}` }, error: null };
      },
    }),
  },
};
