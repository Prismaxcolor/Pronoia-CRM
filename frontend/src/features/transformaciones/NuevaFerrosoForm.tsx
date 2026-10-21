import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import type { Almacen, Producto, Tara } from '@shared/types/index.js';
import { obtenerStockAlmacen } from '../../services/almacen-service';
import { crearTransformacionF4 } from '../../services/transformacion-cola';
import { useToast } from '../../hooks/use-toast-context';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { difiereEstado } from '../../lib/borrador';
import { aPesadasConFotos, pesadaEntradaVacia, totalesEntrada, validarPesadasEntrada, type PesadaEntradaForm } from '../../lib/entrada-pesadas';
import { hoyNegocio } from '../../lib/fecha-negocio';
import AvisoBorrador from '../../components/AvisoBorrador';
import SeleccionarMaterialModal from '../pesaje/SeleccionarMaterialModal';
import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';
import { revocarFotosDeFilas } from '../pesaje/fotos-preview';
import { useRevocarFotosAlDesmontar } from '../pesaje/use-revocar-fotos';
import PesadasEntradaCampo from './PesadasEntradaCampo';
import AvisoSaneoBorrador from './AvisoSaneoBorrador';
import { INPUT_CLASS, LABEL_CLASS } from './clases-formulario';
import { avisoRetiroEnNegativo, sanearNuevaFerroso } from './nueva-transformacion-logica';

interface Props {
  productos: Producto[];
  almacenes: Almacen[];
  taras: Tara[];
  /** Los catálogos ya cargaron: recién entonces se puede validar un borrador restaurado. */
  catalogosListos: boolean;
  onCreada: () => void;
}

/** Formulario: nueva transformación ferroso / no ferroso. */
function NuevaFerrosoForm({ productos, almacenes, taras, catalogosListos, onCreada }: Props) {
  const toast = useToast();

  const [productoEntradaId, setProductoEntradaId] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  // Varias pesadas de entrada: cada una con bruto, tara y fotos; se suman en el neto de entrada.
  const [pesadas, setPesadas] = useState<PesadaEntradaForm[]>(() => [pesadaEntradaVacia()]);
  const [fecha, setFecha] = useState(hoyNegocio());
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [stockAlmacen, setStockAlmacen] = useState<Map<string, number>>(new Map());
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);
  // Las vistas previas de las fotos se liberan al salir del formulario.
  useRevocarFotosAlDesmontar(pesadas.flatMap(p => p.fotos));

  const estadoBorrador = { productoEntradaId, almacenId, pesadasEntrada: pesadas, fecha, notas };
  const restablecer = () => {
    revocarFotosDeFilas(pesadas);
    setProductoEntradaId('');
    setAlmacenId('');
    setPesadas([pesadaEntradaVacia()]);
    setFecha(hoyNegocio());
    setNotas('');
    setAvisoSaneo(null);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'transformacion-nueva-ferroso',
    version: 1,
    habilitado: catalogosListos,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, { productoEntradaId: '', almacenId: '', pesadasEntrada: [pesadaEntradaVacia()], fecha: hoyNegocio(), notas: '' }),
    aplicar: d => {
      // Material, almacén o tara que ya no existen quedan sin elegir, con aviso.
      const v = sanearNuevaFerroso(d, {
        productoIds: productos.map(p => p.id),
        almacenIds: almacenes.map(a => a.id),
        taraIds: taras.map(x => x.id),
        hoy: hoyNegocio(),
      });
      setAvisoSaneo(v.aviso);
      setProductoEntradaId(v.productoEntradaId);
      setAlmacenId(v.almacenId);
      setPesadas(v.pesadas);
      setFecha(v.fecha);
      setNotas(v.notas);
    },
    restablecer,
  });

  const neto = totalesEntrada(pesadas, taras).neto;

  // Aviso (sin bloquear, mismo criterio que traslados en Pesaje) si retirar
  // este neto deja el material en negativo en el almacén elegido.
  useEffect(() => {
    if (!almacenId) return;
    obtenerStockAlmacen(almacenId).then(setStockAlmacen);
  }, [almacenId]);
  // Sin almacén elegido no hay stock que mostrar (se deriva, sin limpiar el estado en el efecto).
  const avisoStock = avisoRetiroEnNegativo({ productoEntradaId, almacenId, neto, stockAlmacen: almacenId ? stockAlmacen : new Map() });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!productoEntradaId) { setError('Selecciona el material de entrada.'); return; }
    if (!almacenId) { setError('Selecciona el almacén.'); return; }
    const errorPesadas = validarPesadasEntrada(pesadas, taras);
    if (errorPesadas) { setError(errorPesadas); return; }

    setGuardando(true);
    // En línea sube las fotos y crea; sin conexión guarda todo en el teléfono (cola) con las mismas fotos.
    const result = await crearTransformacionF4(
      'ferroso',
      { productoEntradaId, almacenId, fecha, notas: notas.trim() || null },
      aPesadasConFotos(pesadas, taras),
    );
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    if (result.enCola) toast.info('Transformación guardada en el teléfono. Se enviará al volver la conexión; podrás completarla cuando la tengas.');
    else toast.exito('Transformación iniciada. Complétala cuando tengas las salidas pesadas.');
    borrador.limpiar();
    restablecer();
    onCreada();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <AvisoBorrador className="mb-3" formulario="nueva transformación" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
      <AvisoSaneoBorrador mensaje={avisoSaneo} />
      <div>
        <label className={LABEL_CLASS}>Material de entrada *</label>
        <button
          type="button"
          onClick={() => setMostrarSelectorMaterial(true)}
          className={`${INPUT_CLASS} flex items-center justify-between gap-2 text-left`}
        >
          <span className={productoEntradaId ? 'text-text-primary truncate' : 'text-text-muted'}>
            {productos.find(p => p.id === productoEntradaId)?.nombre ?? '-Selecciona el material a transformar-'}
          </span>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </button>
      </div>

      <div>
        <label className={LABEL_CLASS}>Almacén de origen *</label>
        <select required value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={INPUT_CLASS}>
          <option value="" disabled>-Selecciona el almacén-</option>
          {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>

      <PesadasEntradaCampo pesadas={pesadas} taras={taras} onCambiar={setPesadas} />

      {avisoStock && (
        <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 -mt-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Ese almacén solo tiene {formatearKgPesaje(avisoStock.disponible)} kg disponibles de este material — el inventario quedará en {formatearKgPesaje(avisoStock.quedara)} kg.
          </span>
        </div>
      )}

      <div>
        <label className={LABEL_CLASS}>Fecha</label>
        <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={INPUT_CLASS} />
      </div>

      <div>
        <label className={LABEL_CLASS}>Notas <span className="text-text-muted">(opcional)</span></label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
          className={`${INPUT_CLASS} resize-none`} rows={2} />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button type="submit" disabled={guardando}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
        {guardando ? <><Loader2 size={15} className="animate-spin" /> Registrando...</> : 'Iniciar transformación'}
      </button>

      {mostrarSelectorMaterial && (
        <SeleccionarMaterialModal
          productos={productos}
          onClose={() => setMostrarSelectorMaterial(false)}
          onSeleccionar={id => { setProductoEntradaId(id); setMostrarSelectorMaterial(false); }}
        />
      )}
    </form>
  );
}

export default NuevaFerrosoForm;
