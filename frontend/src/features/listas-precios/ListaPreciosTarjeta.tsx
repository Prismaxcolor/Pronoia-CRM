import type { CSSProperties } from 'react';
import { estiloCategoria } from '../../lib/colores-categoria';
import { formatearNumero } from '../../lib/formato';
import type { UnidadTarjeta } from '../../lib/lista-precios-imagen';

/** Ancho fijo de la imagen (px CSS). Con pixelRatio 2 sale a 2160 px: nítida en cualquier celular. */
export const ANCHO_TARJETA_PX = 1080;

/** Tarjeta pensada para WhatsApp: fondo sólido, sin elementos de interfaz, tipografía grande.
 *  Usa los tokens de marca del proyecto (con respaldo) para que siga el tema verde/azul. */
const COLOR = {
  marca: 'var(--color-brand-700, #165A31)',
  marcaOscura: 'var(--color-brand-800, #124927)',
  marcaClara: 'var(--color-brand-50, #EEF8F2)',
  marcaMedia: 'var(--color-brand-100, #D5EEDF)',
  texto: '#111827',
  textoSuave: '#4B5563',
  linea: '#D9DEE5',
  filaPar: '#F4F6F8',
  fondo: '#FFFFFF',
} as const;

const PADDING_LATERAL = 64;
const ALTO_FILA = 84;

const estilos = {
  tarjeta: {
    width: ANCHO_TARJETA_PX, boxSizing: 'border-box', background: COLOR.fondo, color: COLOR.texto,
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column',
  },
  cabecera: {
    background: COLOR.marcaOscura, color: '#FFFFFF', padding: `44px ${PADDING_LATERAL}px`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  marca: { display: 'flex', alignItems: 'center', gap: 24 },
  nombreMarca: { fontSize: 44, fontWeight: 800, letterSpacing: 6, lineHeight: 1 },
  pagina: {
    fontSize: 26, fontWeight: 700, padding: '10px 24px', borderRadius: 999,
    background: 'rgba(255,255,255,0.16)', fontVariantNumeric: 'tabular-nums',
  },
  bloqueTitulo: { padding: `48px ${PADDING_LATERAL}px 36px` },
  sobretitulo: { fontSize: 28, fontWeight: 800, letterSpacing: 5, textTransform: 'uppercase', color: COLOR.marca },
  nombreLista: { fontSize: 68, fontWeight: 800, lineHeight: 1.1, margin: '14px 0 0', letterSpacing: -1 },
  datos: { display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 28 },
  dato: {
    fontSize: 27, fontWeight: 600, color: COLOR.marca, background: COLOR.marcaClara,
    border: `2px solid ${COLOR.marcaMedia}`, borderRadius: 999, padding: '8px 22px',
  },
  actualizado: { fontSize: 27, color: COLOR.textoSuave, marginTop: 24, fontVariantNumeric: 'tabular-nums' },
  tabla: { margin: `0 ${PADDING_LATERAL}px`, borderTop: `4px solid ${COLOR.marca}` },
  encabezadoColumnas: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '18px 28px',
    fontSize: 24, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: COLOR.textoSuave,
    borderBottom: `2px solid ${COLOR.linea}`,
  },
  fila: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 32,
    minHeight: ALTO_FILA, padding: '10px 28px', boxSizing: 'border-box',
  },
  material: { fontSize: 36, fontWeight: 600, lineHeight: 1.2, flex: 1, minWidth: 0, overflowWrap: 'anywhere' },
  precio: {
    fontSize: 42, fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    letterSpacing: -0.5,
  },
  grupo: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '0 28px', height: 66, marginTop: 14,
    background: COLOR.marcaClara, fontSize: 27, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase',
    color: COLOR.marcaOscura,
  },
  pie: { margin: `40px ${PADDING_LATERAL}px 0`, borderTop: `2px solid ${COLOR.linea}`, padding: '28px 0 48px' },
  leyenda: { fontSize: 25, lineHeight: 1.45, color: COLOR.textoSuave },
  pieInferior: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, fontSize: 25,
    fontWeight: 700, color: COLOR.marca,
  },
} satisfies Record<string, CSSProperties>;

export interface ListaPreciosTarjetaProps {
  nombreLista: string;
  /** "Lista de venta · Para clientes". */
  tipoLista: string;
  /** "Vigente desde 07/10/2026"; null si la lista no tiene fecha de vigencia. */
  vigencia: string | null;
  /** "07/10/2026 14:05" en hora de Caracas. */
  generadoEn: string;
  unidades: readonly UnidadTarjeta[];
  pagina: number;
  totalPaginas: number;
  /** Teléfono u otro dato de contacto; si no se indica, no se muestra. */
  contacto?: string;
}

function EncabezadoGrupo({ unidad }: { unidad: Extract<UnidadTarjeta, { tipo: 'grupo' }> }) {
  const estilo = estiloCategoria(unidad.nombre);
  return (
    <div style={{ ...estilos.grupo, borderLeft: `10px solid ${estilo.color}` }}>
      <span aria-hidden="true" style={{ color: estilo.color }}>{estilo.simbolo}</span>
      <span>{unidad.nombre}{unidad.continuacion ? ' (continuación)' : ''}</span>
    </div>
  );
}

/** Una página de la imagen compartida. Presentacional puro: no depende de la pantalla ni de permisos. */
export default function ListaPreciosTarjeta({
  nombreLista, tipoLista, vigencia, generadoEn, unidades, pagina, totalPaginas, contacto,
}: ListaPreciosTarjetaProps) {
  const hayVarias = totalPaginas > 1;
  let indiceFila = 0;
  return (
    <div style={estilos.tarjeta}>
      <div style={estilos.cabecera}>
        <div style={estilos.marca}>
          <img src="/logo-pronoia.png" alt="" width={96} height={96} style={{ display: 'block' }} />
          <span style={estilos.nombreMarca}>PRONOIA</span>
        </div>
        {hayVarias && <span style={estilos.pagina}>Página {pagina}/{totalPaginas}</span>}
      </div>

      <div style={estilos.bloqueTitulo}>
        <div style={estilos.sobretitulo}>Lista de precios</div>
        <h1 style={estilos.nombreLista}>{nombreLista}</h1>
        <div style={estilos.datos}>
          <span style={estilos.dato}>{tipoLista}</span>
          {vigencia && <span style={estilos.dato}>{vigencia}</span>}
        </div>
        <div style={estilos.actualizado}>Precios al {generadoEn} (hora de Caracas)</div>
      </div>

      <div style={estilos.tabla}>
        <div style={estilos.encabezadoColumnas}>
          <span>Material</span>
          <span>USD por kg</span>
        </div>
        {unidades.map(unidad => {
          if (unidad.tipo === 'grupo') return <EncabezadoGrupo key={unidad.clave} unidad={unidad} />;
          const fondo = indiceFila++ % 2 === 1 ? COLOR.filaPar : COLOR.fondo;
          return (
            <div key={unidad.clave} style={{ ...estilos.fila, background: fondo, borderBottom: `1px solid ${COLOR.linea}` }}>
              <span style={estilos.material}>{unidad.fila.material}</span>
              <span style={estilos.precio}>{formatearNumero(unidad.fila.precio, 2)}</span>
            </div>
          );
        })}
      </div>

      <div style={estilos.pie}>
        <div style={estilos.leyenda}>
          Precios en dólares (USD) por kilogramo. Sujetos a cambio sin previo aviso.
        </div>
        <div style={estilos.pieInferior}>
          <span>{contacto ?? 'Pronoia'}</span>
          {hayVarias && <span style={{ color: COLOR.textoSuave }}>Página {pagina} de {totalPaginas}</span>}
        </div>
      </div>
    </div>
  );
}
