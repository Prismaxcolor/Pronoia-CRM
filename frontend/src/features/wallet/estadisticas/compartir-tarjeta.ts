/** Genera la imagen PNG de una tarjeta de Estadísticas: la tarjeta con su fondo real, más un encabezado con la marca y el
 *  rótulo del período y un pie con la fecha. Trabaja sobre una COPIA fuera de pantalla: la tarjeta visible no se toca.
 *  Los montos de la copia son los mismos que se ven en pantalla (ya enmascarados si se ocultan las cantidades). */

import { colorFondoReal, renderizarElementoAPng } from '../../../lib/compartir-imagen';
import { TIEMPO_MAXIMO_IMAGEN_MS, conTiempoMaximo, type RotuloImagen } from './estadisticas-compartir';

const MARGEN_PX = 16;

function linea(texto: string, estilo: Partial<CSSStyleDeclaration>): HTMLElement {
  const el = document.createElement('div');
  el.textContent = texto;
  Object.assign(el.style, estilo);
  return el;
}

function encabezado(r: RotuloImagen): HTMLElement {
  const fila = document.createElement('div');
  Object.assign(fila.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '10px' });
  fila.append(
    linea(r.marca, { fontSize: '15px', fontWeight: '700', color: 'var(--color-w-acento)' }),
    linea(r.periodo, { fontSize: '11px', letterSpacing: '0.04em', color: 'var(--color-w-texto2)', textAlign: 'right' }),
  );
  return fila;
}

/** Quita de la copia las imágenes que en pantalla ya no cargaron: html-to-image no tiene tiempo máximo al descargarlas y una
 *  imagen inalcanzable la hacía esperar hasta ~15 s (medido). Las que sí se ven se conservan. */
function quitarImagenesRotas(original: HTMLElement, copia: HTMLElement): void {
  const rotas = [...original.querySelectorAll('img')].map(i => i.complete && i.naturalWidth === 0);
  copia.querySelectorAll('img').forEach((img, i) => { if (rotas[i]) img.remove(); });
}

/** Copia de la tarjeta sin lo que no debe salir en la imagen (botones marcados, tablas solo para lectores) ni ids duplicados. */
function copiaLimpia(tarjeta: HTMLElement): HTMLElement {
  const copia = tarjeta.cloneNode(true) as HTMLElement;
  copia.querySelectorAll('[data-no-imagen]').forEach(n => n.remove());
  quitarImagenesRotas(tarjeta, copia);
  copia.removeAttribute('id');
  copia.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  return copia;
}

export async function renderizarTarjetaAPng(tarjeta: HTMLElement, rotulo: RotuloImagen): Promise<Blob> {
  const fondo = colorFondoReal(tarjeta);
  const afuera = document.createElement('div');
  // El contenedor externo se esconde fuera de pantalla; el interno (el que se fotografía) queda sin posición propia.
  Object.assign(afuera.style, { position: 'fixed', top: '0', left: '-100000px', pointerEvents: 'none' });
  afuera.setAttribute('aria-hidden', 'true');
  const interno = document.createElement('div');
  Object.assign(interno.style, {
    width: `${tarjeta.offsetWidth + MARGEN_PX * 2}px`, padding: `${MARGEN_PX}px`, backgroundColor: fondo,
    color: getComputedStyle(tarjeta).color, boxSizing: 'border-box',
  });
  interno.append(
    encabezado(rotulo),
    copiaLimpia(tarjeta),
    linea(rotulo.pie, { marginTop: '10px', fontSize: '11px', color: 'var(--color-w-texto2)', textAlign: 'right' }),
  );
  afuera.append(interno);
  document.body.append(afuera);
  try {
    // Con tiempo máximo: si el navegador no termina (imagen que no baja, tarjeta enorme), falla y el botón lo avisa con un mensaje.
    return await conTiempoMaximo(renderizarElementoAPng(interno, { fondo, conservarBotones: true }), TIEMPO_MAXIMO_IMAGEN_MS);
  } finally {
    afuera.remove();
  }
}
