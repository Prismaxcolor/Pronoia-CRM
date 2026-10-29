import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  obtenerProveedores,
  desactivarProveedor,
  reactivarProveedor,
  borrarProveedor,
  ocultarProveedor,
  generarLinkTelegramProveedor,
} from '../../services/proveedor-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import ProveedorFormModal from './ProveedorFormModal';
import ListadoTerceros from './ListadoTerceros';
import TelegramLinkModal from '../../components/TelegramLinkModal';
import type { Proveedor } from '@shared/types/index.js';

function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  // Sube cada vez que la lista se recarga: ListadoTerceros vuelve a pedir los saldos.
  const [version, setVersion] = useState(0);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; proveedor: Proveedor | null } | { abierto: false }>({ abierto: false });
  const [telegramAbierto, setTelegramAbierto] = useState<Proveedor | null>(null);
  const { tienePermiso, usuario } = useAuth();
  const esSuperadmin = usuario?.rol === 'superadmin';
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('proveedores', 'crear');
  const puedeEditar = tienePermiso('proveedores', 'editar');
  const puedeBorrar = tienePermiso('proveedores', 'eliminar');

  // La lista no vuelve a mostrar el esqueleto al recargar: solo en la primera carga.
  const cargar = useCallback(
    () => obtenerProveedores().then(setProveedores).finally(() => { setCargando(false); setVersion(v => v + 1); }),
    [],
  );

  useEffect(() => { cargar(); }, [cargar]);

  const buscar = useCallback((id: string) => proveedores.find(p => p.id === id), [proveedores]);

  const handleDesactivar = useCallback(async (id: string) => {
    const p = buscar(id);
    if (!p) return;
    const ok = await confirmar({
      titulo: `Desactivar a "${p.nombre}"`,
      mensaje: 'Dejará de aparecer en los selectores activos, pero su historial se conserva.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarProveedor(p.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${p.nombre}" desactivado.`);
    cargar();
  }, [buscar, confirmar, toast, cargar]);

  const handleReactivar = useCallback(async (id: string) => {
    const p = buscar(id);
    if (!p) return;
    const result = await reactivarProveedor(p.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${p.nombre}" reactivado.`);
    cargar();
  }, [buscar, toast, cargar]);

  const handleBorrar = useCallback(async (id: string) => {
    const p = buscar(id);
    if (!p) return;
    const ok = await confirmar({
      titulo: `Borrar a "${p.nombre}" definitivamente`,
      mensaje: 'Esta acción es irreversible.',
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarProveedor(p.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${p.nombre}" eliminado.`);
    cargar();
  }, [buscar, confirmar, toast, cargar]);

  const handleOcultar = useCallback(async (id: string) => {
    const p = buscar(id);
    if (!p) return;
    const ocultar = !p.oculto;
    const ok = await confirmar({
      titulo: ocultar ? `Ocultar a "${p.nombre}"` : `Mostrar a "${p.nombre}"`,
      mensaje: ocultar
        ? 'Dejará de verse para todos los usuarios que no son superadmin: su ficha, facturas, pesajes, pagos, saldos y reportes. Tú lo seguirás viendo. Puedes volver a mostrarlo cuando quieras.'
        : 'Volverá a verse para todos los usuarios, con todo su historial.',
      confirmarLabel: ocultar ? 'Ocultar' : 'Mostrar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await ocultarProveedor(p.id, ocultar);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(ocultar ? `"${p.nombre}" ahora está oculto.` : `"${p.nombre}" vuelve a verse para todos.`);
    cargar();
  }, [buscar, confirmar, toast, cargar]);

  const generarLinkTelegram = useCallback(async () => {
    if (!telegramAbierto) return { error: 'Sin proveedor seleccionado.' };
    return generarLinkTelegramProveedor(telegramAbierto.id);
  }, [telegramAbierto]);

  const telegramYaVinculado = useCallback(async () => {
    if (!telegramAbierto) return false;
    const actualizados = await obtenerProveedores();
    return actualizados.some(p => p.id === telegramAbierto.id && !!p.telegramChatId);
  }, [telegramAbierto]);

  // La lista muestra el RIF del proveedor como "identificación" (igual que los clientes).
  const terceros = useMemo(() => proveedores.map(p => ({ ...p, identificacion: p.rfc })), [proveedores]);

  return (
    <>
      <ListadoTerceros
        tipo="proveedor"
        terceros={terceros}
        cargando={cargando}
        version={version}
        puedeCrear={puedeCrear}
        puedeEditar={puedeEditar}
        puedeBorrar={puedeBorrar}
        onNuevo={() => setFormAbierto({ abierto: true, proveedor: null })}
        onEditar={id => { const p = buscar(id); if (p) setFormAbierto({ abierto: true, proveedor: p }); }}
        onDesactivar={handleDesactivar}
        onReactivar={handleReactivar}
        onBorrar={handleBorrar}
        onVincularTelegram={id => setTelegramAbierto(buscar(id) ?? null)}
        onOcultar={esSuperadmin ? handleOcultar : undefined}
      />

      {formAbierto.abierto && (
        <ProveedorFormModal
          proveedor={formAbierto.proveedor}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}

      {telegramAbierto && (
        <TelegramLinkModal
          nombreEntidad={telegramAbierto.nombre}
          generarLink={generarLinkTelegram}
          yaVinculado={telegramYaVinculado}
          onClose={() => setTelegramAbierto(null)}
          onVinculado={() => {
            toast.exito(`"${telegramAbierto.nombre}" vinculó su Telegram.`);
            setTelegramAbierto(null);
            cargar();
          }}
        />
      )}
    </>
  );
}

export default ProveedoresPage;
