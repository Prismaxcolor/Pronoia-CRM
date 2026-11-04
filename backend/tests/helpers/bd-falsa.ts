/**
 * Doble de supabaseAdmin con tablas en memoria para probar servicios sin BD real.
 * Soporta lectura (select/eq/neq/in/order/limit/range/maybeSingle/single), escritura
 * (insert/update/upsert, registradas en `escrituras`) y rpc con respuesta por función.
 * Los joins embebidos NO se evalúan: los fixtures traen las filas ya planas.
 */
export type Fila = Record<string, unknown>;
type Error = { code?: string; message: string } | null;

export interface Escritura {
  tabla: string;
  tipo: 'insert' | 'update' | 'upsert';
  valores: unknown;
}

export interface LlamadaRpc {
  nombre: string;
  args: Record<string, unknown>;
}

export interface BdFalsa {
  tablas: Record<string, Fila[]>;
  /** Error por tabla: toda consulta a esa tabla devuelve ese error. */
  errores: Record<string, NonNullable<Error>>;
  /** Respuesta de cada rpc: valor, función de los argumentos o { error }. */
  rpc: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;
  escrituras: Escritura[];
  llamadasRpc: LlamadaRpc[];
  reiniciar(): void;
  cliente: {
    from(tabla: string): unknown;
    rpc(nombre: string, args: Record<string, unknown>): Promise<{ data: unknown; error: Error }>;
  };
}

export function crearBdFalsa(): BdFalsa {
  const bd: BdFalsa = {
    tablas: {},
    errores: {},
    rpc: {},
    escrituras: [],
    llamadasRpc: [],
    reiniciar() {
      bd.tablas = {};
      bd.errores = {};
      bd.rpc = {};
      bd.escrituras = [];
      bd.llamadasRpc = [];
    },
    cliente: {
      from(tabla: string) {
        const filtros: Array<(f: Fila) => boolean> = [];
        let rango: [number, number] | null = null;
        let limite: number | null = null;
        let escritura: Escritura | null = null;
        const filas = (): Fila[] => {
          let r = (bd.tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)));
          if (rango) r = r.slice(rango[0], rango[1] + 1);
          if (limite != null) r = r.slice(0, limite);
          return r;
        };
        const resultado = () => {
          if (bd.errores[tabla]) return { data: null, error: bd.errores[tabla] };
          if (escritura) {
            bd.escrituras.push(escritura);
            if (escritura.tipo === 'update') {
              const tocadas = filas();
              for (const f of tocadas) Object.assign(f, escritura.valores as Fila);
              return { data: tocadas, error: null };
            }
            return { data: null, error: null };
          }
          return { data: filas(), error: null };
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          select: () => b,
          eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return b; },
          neq: (c: string, v: unknown) => { filtros.push(f => f[c] !== v); return b; },
          in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(f[c])); return b; },
          gte: (c: string, v: string) => { filtros.push(f => String(f[c] ?? '') >= v); return b; },
          lte: (c: string, v: string) => { filtros.push(f => String(f[c] ?? '') <= v); return b; },
          is: (c: string, v: unknown) => { filtros.push(f => (f[c] ?? null) === v); return b; },
          order: () => b,
          limit: (n: number) => { limite = n; return b; },
          range: (desde: number, hasta: number) => { rango = [desde, hasta]; return b; },
          insert: (valores: unknown) => { escritura = { tabla, tipo: 'insert', valores }; return b; },
          update: (valores: unknown) => { escritura = { tabla, tipo: 'update', valores }; return b; },
          upsert: (valores: unknown) => { escritura = { tabla, tipo: 'upsert', valores }; return b; },
          maybeSingle: async () => {
            const r = resultado();
            return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error };
          },
          single: async () => {
            const r = resultado();
            return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error };
          },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(res, rej),
        };
        return b;
      },
      async rpc(nombre, args) {
        bd.llamadasRpc.push({ nombre, args });
        const r = bd.rpc[nombre];
        if (r === undefined) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nombre}` } };
        const valor = typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r;
        if (valor && typeof valor === 'object' && 'error' in (valor as object) && !('data' in (valor as object))) {
          return { data: null, error: (valor as { error: NonNullable<Error> }).error };
        }
        return { data: valor, error: null };
      },
    },
  };
  return bd;
}
