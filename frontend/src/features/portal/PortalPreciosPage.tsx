import { useEffect, useMemo, useState } from 'react';
import { obtenerPreciosPortal, type ListaPreciosPortal } from '../../services/portal-precios-service';
import { Bloque, EstadoVacio, SkeletonTabla, TablaDatos } from '../../components/ui';
import { formatearUsdDecimales } from '../../lib/formato';
import { fechaCorta } from '../../lib/portal-kpis';
import type { ColumnaTabla } from '../../lib/tabla-datos';
import PortalLayout from './PortalLayout';

type Precio = ListaPreciosPortal['precios'][number];

function PortalPreciosPage() {
  const [listas, setListas] = useState<ListaPreciosPortal[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerPreciosPortal().then(setListas).finally(() => setCargando(false));
  }, []);

  const columnas = useMemo<ColumnaTabla<Precio>[]>(() => [
    { clave: 'material', titulo: 'Material', valorOrden: p => p.nombreProducto ?? 'Material', celda: p => p.nombreProducto ?? 'Material' },
    {
      clave: 'precio', titulo: 'Precio por kg', alinear: 'derecha', valorOrden: p => p.precio,
      celda: p => `${formatearUsdDecimales(p.precio)} / kg`, valorCsv: p => p.precio, decimalesCsv: 2,
    },
  ], []);

  return (
    <PortalLayout titulo="Lista de precios" subtitulo="Precios vigentes por material, en dólares por kilo.">
      {cargando ? (
        <SkeletonTabla filas={4} columnas={2} />
      ) : listas.length ? (
        listas.map(({ lista, precios }) => (
          <Bloque
            key={lista.id}
            titulo={lista.nombre}
            queEstasViendo={lista.vigenteDesde ? `Cuánto vale cada kilo de cada material, en USD, según la lista que Pronoia publicó para ti. Rige desde el ${fechaCorta(lista.vigenteDesde)}.` : 'Cuánto vale cada kilo de cada material, en USD, según la lista que Pronoia publicó para ti.'}
          >
            <TablaDatos
              titulo={`Precios de ${lista.nombre}`} columnas={columnas} filas={precios} claveFila={p => p.id}
              anchoMinimo="min-w-[20rem]" exportar={{ nombreArchivo: 'lista-de-precios' }}
              vacio={{ mensaje: 'Esta lista aún no tiene precios cargados.', descripcion: 'Pronoia los publicará aquí cuando estén definidos.' }}
            />
          </Bloque>
        ))
      ) : (
        <EstadoVacio
          mensaje="No hay listas de precios vigentes por el momento."
          descripcion="Cuando Pronoia publique una lista para ti, la verás aquí con los precios por material."
        />
      )}
    </PortalLayout>
  );
}

export default PortalPreciosPage;
