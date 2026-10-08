import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderizarElementoAPng } from '../../lib/compartir-imagen';
import { formatearFechaNegocio, formatearFechaHora } from '../../lib/fecha-negocio';
import { paginarListaPrecios, type FilaPrecioImagen } from '../../lib/lista-precios-imagen';
import ListaPreciosTarjeta, { ANCHO_TARJETA_PX, type ListaPreciosTarjetaProps } from './ListaPreciosTarjeta';

export interface DatosImagenListaPrecios {
  nombreLista: string;
  tipo: 'venta' | 'compra';
  /** AAAA-MM-DD (columna date) o null. */
  vigenteDesde: string | null;
  filas: readonly FilaPrecioImagen[];
  contacto?: string;
  /** Solo para pruebas: instante "ahora" fijo. */
  ahora?: Date;
}

/** Margen fuera de la ventana: el contenedor no se ve, pero el navegador sí lo maqueta. */
const POSICION_FUERA_DE_PANTALLA = -20_000;

type DatosPagina = Omit<ListaPreciosTarjetaProps, 'unidades' | 'pagina' | 'totalPaginas'>;

function datosComunes(datos: DatosImagenListaPrecios): DatosPagina {
  return {
    nombreLista: datos.nombreLista,
    tipoLista: datos.tipo === 'venta' ? 'Lista de venta · Para clientes' : 'Lista de compra · Para proveedores',
    vigencia: datos.vigenteDesde ? `Vigente desde ${formatearFechaNegocio(datos.vigenteDesde)}` : null,
    generadoEn: formatearFechaHora(datos.ahora ?? new Date()),
    contacto: datos.contacto,
  };
}

/** Espera a que el logo y las tipografías estén listos: si no, la captura saldría sin ellos. */
async function esperarRecursos(raiz: HTMLElement): Promise<void> {
  const imagenes = Array.from(raiz.querySelectorAll('img'));
  await Promise.all(imagenes.map(img => img.decode().catch(() => undefined)));
  if (document.fonts) await document.fonts.ready;
}

/** Renderiza cada página de la lista como tarjeta fuera de pantalla y devuelve un PNG por página. */
export async function renderizarImagenesListaPrecios(datos: DatosImagenListaPrecios): Promise<Blob[]> {
  const paginas = paginarListaPrecios(datos.filas);
  if (paginas.length === 0) return [];
  const comunes = datosComunes(datos);

  const anfitrion = document.createElement('div');
  anfitrion.setAttribute('aria-hidden', 'true');
  anfitrion.style.cssText = `position:fixed;top:0;left:${POSICION_FUERA_DE_PANTALLA}px;width:${ANCHO_TARJETA_PX}px;pointer-events:none;`;
  document.body.appendChild(anfitrion);
  const raiz = createRoot(anfitrion);
  try {
    flushSync(() => {
      raiz.render(
        <>
          {paginas.map((unidades, i) => (
            <div key={i} data-tarjeta-lista>
              <ListaPreciosTarjeta {...comunes} unidades={unidades} pagina={i + 1} totalPaginas={paginas.length} />
            </div>
          ))}
        </>,
      );
    });
    await esperarRecursos(anfitrion);
    const blobs: Blob[] = [];
    for (const nodo of anfitrion.querySelectorAll<HTMLElement>('[data-tarjeta-lista]')) {
      blobs.push(await renderizarElementoAPng(nodo));
    }
    return blobs;
  } finally {
    raiz.unmount();
    anfitrion.remove();
  }
}
