import { useState } from 'react';
import { useLiberarVistasPrevias } from '../../hooks/use-liberar-vistas-previas';
import Modal from '../../components/Modal';
import { altaEnColaActiva } from '../../services/maestros-cola';
import { X } from 'lucide-react';
import { crearProveedor, actualizarProveedor } from '../../services/proveedor-service';
import { subirFotoProveedor } from '../../services/storage-service';
import { useToast } from '../../hooks/use-toast-context';
import { fotoLocalDeFile, fotosLocalDeUrls, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import SwitchAvisosTelegram from '../../components/SwitchAvisosTelegram';
import { useAuth } from '../../hooks/use-auth-context';
import AvisoBorrador from '../../components/AvisoBorrador';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { CAMPOS_PERSONALES_BORRADOR, TTL_ALTA_BORRADOR_MS, difiereEstado, huellaDocumento, serializarEstado } from '../../lib/borrador';
import type { Proveedor } from '@shared/types/index.js';

interface Props {
  /** Si se pasa, modo "editar". Si no, modo "crear". */
  proveedor?: Proveedor | null;
  onClose: () => void;
  onGuardado: () => void;
}

function ProveedorFormModal({ proveedor, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!proveedor;
  const { usuario } = useAuth();
  // Solo el superadmin ve y cambia el interruptor, y solo al editar (al crear arranca activo).
  const puedeCambiarAvisos = editando && usuario?.rol === 'superadmin';
  const [avisosActivos, setAvisosActivos] = useState(proveedor?.telegramReportesActivos !== false);

  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [rfc, setRfc] = useState(proveedor?.rfc ?? '');
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '');
  const [email, setEmail] = useState(proveedor?.email ?? '');
  const [direccion, setDireccion] = useState(proveedor?.direccion ?? '');
  const [fotos, setFotos] = useState<FotoLocal[]>(() => fotosLocalDeUrls(proveedor?.fotos ?? []));
  useLiberarVistasPrevias(fotos);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Borrador del formulario (uno por proveedor, o uno para "nuevo"): sobrevive a F5.
  const estadoBorrador = { nombre, rfc, telefono, email, direccion, fotos };
  const estadoInicial = () => ({
    nombre: proveedor?.nombre ?? '', rfc: proveedor?.rfc ?? '', telefono: proveedor?.telefono ?? '', email: proveedor?.email ?? '', direccion: proveedor?.direccion ?? '',
    fotos: fotosLocalDeUrls(proveedor?.fotos ?? []),
  });
  const aplicarEstado = (e: ReturnType<typeof estadoInicial>) => {
    setNombre(e.nombre); setRfc(e.rfc); setTelefono(e.telefono); setEmail(e.email); setDireccion(e.direccion); setFotos(e.fotos);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'proveedor',
    docId: proveedor?.id ?? null,
    version: 1,
    // Alta de maestro: sin pesos ni dinero, conserva el TTL largo. RIF/RFC, correo y teléfono
    // no se guardan en el navegador (se vuelven a escribir); el resto de la base se toma del proveedor actual.
    ttlMs: TTL_ALTA_BORRADOR_MS,
    excluirCampos: CAMPOS_PERSONALES_BORRADOR,
    // Editar: si el proveedor cambió en el servidor desde que se guardó el borrador, este se descarta con aviso.
    huellaBase: proveedor ? huellaDocumento(serializarEstado(estadoInicial(), CAMPOS_PERSONALES_BORRADOR)) : null,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, estadoInicial(), CAMPOS_PERSONALES_BORRADOR),
    aplicar: d => {
      const base = estadoInicial();
      aplicarEstado({
        nombre: d.nombre ?? base.nombre, rfc: d.rfc ?? base.rfc, telefono: d.telefono ?? base.telefono,
        email: d.email ?? base.email, direccion: d.direccion ?? base.direccion, fotos: d.fotos ?? base.fotos,
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
    setGuardando(true);
    setError(null);

    const enCola = !editando && altaEnColaActiva();
    const urls = enCola ? [] : await subirFotosLocal(fotos, subirFotoProveedor);
    if (!urls) {
      setError('Error al subir una de las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }

    const payload = {
      nombre: nombre.trim(),
      rfc: rfc.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      // Solo si cambió: mientras la columna no exista en la base, guardar sin tocar la dirección sigue funcionando.
      ...(direccion.trim() !== (proveedor?.direccion ?? '') ? { direccion: direccion.trim() || null } : {}),
      fotos: urls,
      ...(puedeCambiarAvisos ? { telegramReportesActivos: avisosActivos } : {}),
    };

    const result = editando && proveedor
      ? await actualizarProveedor(proveedor.id, payload)
      : await crearProveedor(payload, enCola ? fotos : undefined);

    setGuardando(false);

    if ('proveedor' in result) {
      toast.exito(editando ? `"${result.proveedor.nombre}" actualizado.` : `"${result.proveedor.nombre}" ${'enCola' in result ? 'guardado en el teléfono; se enviará al volver la conexión' : 'creado'}.`);
      borrador.limpiar();
      onGuardado();
    } else {
      setError(result.error);
    }
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <Modal onClose={cerrar} bloqueado={guardando}>
      <div className="flex items-center justify-between p-5 border-b border-border">
        <h2 className="text-lg font-bold text-text-primary">
          {editando ? 'Editar proveedor' : 'Nuevo proveedor'}
        </h2>
        <button type="button" onClick={cerrar} className="text-text-muted hover:text-text-primary transition-colors">
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <AvisoBorrador formulario="este proveedor" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        <FotoMultiplePicker fotos={fotos} onAgregar={agregarFotos} onQuitar={quitarFoto} label="Fotos" />

        <div>
          <label className={labelClass}>Nombre *</label>
          <input
            type="text"
            required
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            className={inputClass}
            placeholder="Ej. Reciclados El Valle C.A."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>RIF / Cédula</label>
            <input
              type="text"
              value={rfc}
              onChange={e => setRfc(e.target.value)}
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
              placeholder="+58 412 1234567"
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
            placeholder="proveedor@ejemplo.com"
          />
        </div>

        <div>
          <label className={labelClass}>Dirección</label>
          <input
            type="text"
            value={direccion}
            onChange={e => setDireccion(e.target.value)}
            className={inputClass}
            placeholder="Av. Principal, Galpón..."
          />
        </div>

        {puedeCambiarAvisos && (
          <SwitchAvisosTelegram
            id="proveedor-avisos-telegram"
            checked={avisosActivos}
            onChange={setAvisosActivos}
            ayuda={"Apagado: los pagos, adelantos, cruces y notas de este proveedor no se avisan a Telegram (ni al grupo de cajas ni a su chat). Las facturas y el estado de cuenta enviado a mano no cambian. Solo lo ve el superadmin."}
          />
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
            {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear proveedor'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default ProveedorFormModal;
