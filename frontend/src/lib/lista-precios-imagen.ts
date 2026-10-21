/** Reparto de una lista de precios en páginas para la imagen que se comparte (WhatsApp).
 *  Lógica pura (sin React ni DOM). Una imagen con demasiadas filas se vuelve ilegible en el
 *  celular, así que la lista se divide en varias imágenes de tamaño parecido. */

export interface FilaPrecioImagen {
  id: string;
  material: string;
  precio: number;
  /** Categoría del material (PCB, Ferroso…); null si no se conoce. */
  categoria: string | null;
}

export type UnidadTarjeta =
  | { tipo: 'grupo'; clave: string; nombre: string; continuacion: boolean }
  | { tipo: 'fila'; clave: string; fila: FilaPrecioImagen };

/** Unidades (filas + encabezados de grupo) por imagen. */
export const MAX_UNIDADES_POR_IMAGEN = 18;
export const NOMBRE_GRUPO_SIN_CATEGORIA = 'Otros materiales';

interface Grupo {
  nombre: string | null;
  filas: FilaPrecioImagen[];
}

/** Agrupa por categoría respetando el orden de la lista (el grupo aparece donde está su primer material).
 *  Si ningún material trae categoría, un solo grupo sin nombre (sin encabezados de grupo). */
export function agruparPorCategoria(filas: readonly FilaPrecioImagen[]): Grupo[] {
  if (filas.every(f => !f.categoria?.trim())) return filas.length ? [{ nombre: null, filas: [...filas] }] : [];
  const grupos = new Map<string, Grupo>();
  for (const fila of filas) {
    const nombre = fila.categoria?.trim() || NOMBRE_GRUPO_SIN_CATEGORIA;
    const grupo = grupos.get(nombre);
    if (grupo) grupo.filas.push(fila);
    else grupos.set(nombre, { nombre, filas: [fila] });
  }
  return [...grupos.values()];
}

function repartir(grupos: Grupo[], limite: number): UnidadTarjeta[][] {
  const paginas: UnidadTarjeta[][] = [[]];
  let usadas = 0;
  for (const grupo of grupos) {
    let primera = true;
    for (const fila of grupo.filas) {
      const conEncabezado = (g: boolean) => grupo.nombre !== null && (primera || g);
      let paginaVacia = usadas === 0;
      // Un encabezado nunca queda solo al final de una página: se exige espacio para encabezado + fila.
      if (usadas + (conEncabezado(paginaVacia) ? 2 : 1) > limite && usadas > 0) {
        paginas.push([]);
        usadas = 0;
        paginaVacia = true;
      }
      if (conEncabezado(paginaVacia) && grupo.nombre !== null) {
        paginas[paginas.length - 1].push({
          tipo: 'grupo', clave: `g-${paginas.length}-${grupo.nombre}`, nombre: grupo.nombre, continuacion: !primera,
        });
        usadas += 1;
      }
      paginas[paginas.length - 1].push({ tipo: 'fila', clave: fila.id, fila });
      usadas += 1;
      primera = false;
    }
  }
  return paginas;
}

/** Divide la lista en páginas de a lo sumo `max` unidades, con tamaños parejos (15/15/14, no 18/18/8). */
export function paginarListaPrecios(filas: readonly FilaPrecioImagen[], max = MAX_UNIDADES_POR_IMAGEN): UnidadTarjeta[][] {
  const grupos = agruparPorCategoria(filas);
  if (grupos.length === 0) return [];
  const base = repartir(grupos, max);
  if (base.length === 1) return base;
  const total = base.reduce((suma, p) => suma + p.length, 0);
  for (let limite = Math.ceil(total / base.length); limite < max; limite++) {
    const intento = repartir(grupos, limite);
    if (intento.length === base.length) return intento;
  }
  return base;
}
