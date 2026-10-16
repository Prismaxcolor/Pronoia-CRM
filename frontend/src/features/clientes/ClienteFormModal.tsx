import { useState } from 'react';
import { altaEnColaActiva } from '../../services/maestros-cola';
import { X } from 'lucide-react';
import { crearCliente, actualizarCliente } from '../../services/cliente-service';
import { subirFotoCliente } from '../../services/storage-service';
import { useToast } from '../../hooks/use-toast-context';
import { fotoLocalDeFile, fotosLocalDeUrls, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import AvisoBorrador from '../../components/AvisoBorrador';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { CAMPOS_PERSONALES_BORRADOR, TTL_ALTA_BORRADOR_MS, difiereEstado, huellaDocumento, serializarEstado } from '../../lib/borrador';
import type { Cliente, TipoVentaCliente } from '@shared/types/index.js';

interface Props {
  /** Si se pasa, modo "editar". Si no, modo "crear". */
  cliente?: Cliente | null;
  onClose: () => void;
  onGuardado: (modo: 'crear' | 'editar') => void;
}

function ClienteFormModal({ cliente, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!cliente;

  const [nombre, setNombre] = useState(cliente?.nombre ?? '');
  // Sin predeterminado al crear: hay que elegirlo. Al editar parte del valor actual.
  const [tipoVenta, setTipoVenta] = useState<TipoVentaCliente | ''>(cliente?.tipoVenta ?? '');
  const [identificacion, setIdentificacion] = useState(cliente?.identificacion ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '');
  const [direccion, setDireccion] = useState(cliente?.direccion ?? '');
  const [notas, setNotas] = useState(cliente?.notas ?? '');
  const [fotos, setFotos] = useState<FotoLocal[]>(() => fotosLocalDeUrls(cliente?.fotos ?? []));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Borrador del formulario (uno por cliente, o uno para "nuevo"): sobrevive a F5.
  const estadoBorrador = { nombre, tipoVenta, identificacion, email, telefono, direccion, notas, fotos };
  const estadoInicial = () => ({
    nombre: cliente?.nombre ?? '', tipoVenta: (cliente?.tipoVenta ?? '') as TipoVentaCliente | '', identificacion: cliente?.identificacion ?? '', email: cliente?.email ?? '',
    telefono: cliente?.telefono ?? '', direccion: cliente?.direccion ?? '', notas: cliente?.notas ?? '',
    fotos: fotosLocalDeUrls(cliente?.fotos ?? []),
  });
  const aplicarEstado = (e: ReturnType<typeof estadoInicial>) => {
    setNombre(e.nombre); setTipoVenta(e.tipoVenta); setIdentificacion(e.identificacion); setEmail(e.email);
    setTelefono(e.telefono); setDireccion(e.direccion); setNotas(e.notas); setFotos(e.fotos);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'cliente',
    docId: cliente?.id ?? null,
    version: 1,
    // Alta de maestro: sin pesos ni dinero, conserva el TTL largo. Identificación, correo y teléfono
    // no se guardan en el navegador (se vuelven a escribir); el resto de la base se toma del cliente actual.
    ttlMs: TTL_ALTA_BORRADOR_MS,
    excluirCampos: CAMPOS_PERSONALES_BORRADOR,
    // Editar: si el cliente cambió en el servidor desde que se guardó el borrador, este se descarta con aviso.
    huellaBase: cliente ? huellaDocumento(serializarEstado(estadoInicial(), CAMPOS_PERSONALES_BORRADOR)) : null,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, estadoInicial(), CAMPOS_PERSONALES_BORRADOR),
    aplicar: d => {
      const base = estadoInicial();
      aplicarEstado({
        nombre: d.nombre ?? base.nombre, tipoVenta: d.tipoVenta ?? base.tipoVenta, identificacion: d.identificacion ?? base.identificacion, email: d.email ?? base.email,
        telefono: d.telefono ?? base.telefono, direccion: d.direccion ?? base.direccion, notas: d.notas ?? base.notas,
        fotos: d.fotos ?? base.fotos,
      });
    },
    restablecer: () => aplicarEstado(estadoInicial()),
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const agregarFotos = (files: File[]) => setFotos(prev => [...prev, ...files.map(fotoLocalDeFile)]);
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tipoVenta) { setError('Elige el tipo de venta del cliente.'); return; }
    setGuardando(true);
    setError(null);

    const enCola = !editando && altaEnColaActiva();
    const urls = enCola ? [] : await subirFotosLocal(fotos, subirFotoCliente);
    if (!urls) {
      setError('Error al subir una de las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }

    const payload = {
      nombre: nombre.trim(),
      tipoVenta,
      identificacion: identificacion.trim() || null,
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      direccion: direccion.trim() || null,
      notas: notas.trim() || null,
      fotos: urls,
    };

    const result = editando && cliente
      ? await actualizarCliente(cliente.id, payload)
      : await crearCliente(payload, enCola ? fotos : undefined);

    setGuardando(false);

    if ('cliente' in result) {
      toast.exito(editando ? `"${result.cliente.nombre}" actualizado.` : `"${result.cliente.nombre}" ${'enCola' in result ? 'guardado en el teléfono; se enviará al volver la conexión' : 'creado'}.`);
      borrador.limpiar();
      onGuardado(editando ? 'editar' : 'crear');
    } else {
      setError(result.error);
    }
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">
            {editando ? 'Editar cliente' : 'Nuevo cliente'}
          </h2>
          <button type="button" onClick={cerrar} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <AvisoBorrador formulario="este cliente" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
          <FotoMultiplePicker fotos={fotos} onAgregar={agregarFotos} onQuitar={quitarFoto} label="Fotos" />

          <div>
            <label className={labelClass}>Nombre *</label>
            <input
              type="text"
              required
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              className={inputClass}
              placeholder="Nombre o razón social"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="cliente-tipo-venta">Tipo de venta *</label>
            <select
              id="cliente-tipo-venta"
              required
              value={tipoVenta}
              onChange={e => setTipoVenta(e.target.value as TipoVentaCliente | '')}
              className={inputClass}
            >
              <option value="" disabled>Selecciona…</option>
              <option value="nacional">Venta nacional</option>
              <option value="internacional">Venta internacional</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>RIF / Cédula</label>
              <input
                type="text"
                value={identificacion}
                onChange={e => setIdentificacion(e.target.value)}
                className={inputClass}
                placeholder="J-12345678-9"
              />
            </div>
            <div>
              <label className={labelClass}>Teléfono</label>
              <input
                type="text"
                value={telefono}
                onChange={e => setTelefono(e.target.value)}
                className={inputClass}
                placeholder="+58 414 1234567"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputClass}
              placeholder="cliente@ejemplo.com"
            />
          </div>

          <div>
            <label className={labelClass}>Dirección</label>
            <input
              type="text"
              value={direccion}
              onChange={e => setDireccion(e.target.value)}
              className={inputClass}
              placeholder="Av. Principal, Edificio..."
            />
          </div>

          <div>
            <label className={labelClass}>Notas</label>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              className={`${inputClass} resize-none`}
              rows={3}
              placeholder="Detalles internos del cliente"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ClienteFormModal;
