/**
 * Tema de color por usuario. El verde corporativo es el valor por defecto;
 * 'azul' lo sobrescribe vía `:root[data-marca='azul']` en index.css.
 * La última marca se recuerda en localStorage para pintarla antes del primer
 * render (evita el parpadeo verde -> azul al recargar).
 */
export type TemaMarca = 'azul';

export const CLAVE_MARCA = 'pronoia.marca';

export const COLOR_TEMA = { verde: '#1B6B3A', azul: '#1A80E6' } as const;

export interface AlmacenTema {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

export interface EntornoTema {
  root: { dataset: Record<string, string | undefined> };
  meta: { content: string } | null;
  storage: AlmacenTema | null;
}

export function normalizarTemaMarca(valor: unknown): TemaMarca | null {
  return valor === 'azul' ? 'azul' : null;
}

export function leerTemaMarcaGuardado(storage: AlmacenTema | null): TemaMarca | null {
  try {
    return normalizarTemaMarca(storage?.getItem(CLAVE_MARCA));
  } catch {
    return null;
  }
}

/** Aplica (o quita con null) la marca en el documento y la recuerda. */
export function aplicarTemaMarca(tema: TemaMarca | null, entorno: EntornoTema = entornoNavegador()): void {
  if (tema === 'azul') {
    entorno.root.dataset.marca = 'azul';
  } else {
    delete entorno.root.dataset.marca;
  }
  if (entorno.meta) entorno.meta.content = tema === 'azul' ? COLOR_TEMA.azul : COLOR_TEMA.verde;
  try {
    if (tema === 'azul') entorno.storage?.setItem(CLAVE_MARCA, 'azul');
    else entorno.storage?.removeItem(CLAVE_MARCA);
  } catch {
    // localStorage bloqueado: la marca igual queda aplicada en esta sesión.
  }
}

function entornoNavegador(): EntornoTema {
  let storage: AlmacenTema | null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    root: document.documentElement,
    meta: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),
    storage,
  };
}

/** Pinta la marca recordada antes del primer render. */
export function aplicarTemaMarcaGuardado(): void {
  const entorno = entornoNavegador();
  const tema = leerTemaMarcaGuardado(entorno.storage);
  if (tema) aplicarTemaMarca(tema, entorno);
}
