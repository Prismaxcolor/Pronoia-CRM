/**
 * Doble de supabaseAdmin para las herramientas de consulta de BLOB.
 * Las tablas son filas planas (los joins embebidos ya vienen en el fixture). Aplica de verdad
 * eq / in / neq / ilike / gte / lte / limit, y registra cada consulta para poder afirmar
 * qué tablas se tocaron y con qué tope de filas.
 */
type Fila = Record<string, unknown>;

export const tablas: Record<string, Fila[]> = {};
export const consultas: Array<{ tabla: string; limite: number | null; select: string }> = [];

/** Filtros .or() recibidos, para afirmar que un filtro de acceso viaja en la consulta (no se evalúan). */
export const filtrosOr: Array<{ tabla: string; filtro: string }> = [];

export function reiniciar(): void {
  filtrosOr.length = 0;
  for (const k of Object.keys(tablas)) delete tablas[k];
  consultas.length = 0;
}

function comparable(v: unknown): string {
  return String(v ?? '');
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = [];
  let limite: number | null = null;
  let seleccion = '';
  const filas = () => {
    const todas = (tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)));
    return limite == null ? todas : todas.slice(0, limite);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: (s?: string) => { seleccion = s ?? ''; return b; },
    eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return b; },
    neq: (c: string, v: unknown) => { filtros.push(f => f[c] !== v); return b; },
    in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(f[c])); return b; },
    ilike: (c: string, patron: string) => {
      const trozo = patron.replace(/%/g, '').toLowerCase();
      filtros.push(f => comparable(f[c]).toLowerCase().includes(trozo));
      return b;
    },
    gte: (c: string, v: string) => { filtros.push(f => comparable(f[c]) >= v); return b; },
    lte: (c: string, v: string) => { filtros.push(f => comparable(f[c]) <= v); return b; },
    or: (filtro: string) => { filtrosOr.push({ tabla, filtro }); return b; },
    order: () => b,
    limit: (n: number) => { limite = n; return b; },
    maybeSingle: async () => {
      consultas.push({ tabla, limite, select: seleccion });
      return { data: filas()[0] ?? null, error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      consultas.push({ tabla, limite, select: seleccion });
      return Promise.resolve({ data: filas(), error: null }).then(res, rej);
    },
  };
  return b;
}

export const supabaseConsultasFalso = { from: (tabla: string) => consulta(tabla) };
