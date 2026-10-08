import { useCallback, useEffect, useState } from 'react';
import {
  obtenerClientes,
  desactivarCliente,
  reactivarCliente,
  borrarCliente,
  generarLinkTelegramCliente,
} from '../../services/cliente-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import ClienteFormModal from './ClienteFormModal';
import ListadoTerceros from '../proveedores/ListadoTerceros';
import TelegramLinkModal from '../../components/TelegramLinkModal';
import type { Cliente } from '@shared/types/index.js';

function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  // Sube cada vez que la lista se recarga: ListadoTerceros vuelve a pedir los saldos.
  const [version, setVersion] = useState(0);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; cliente: Cliente | null } | { abierto: false }>({ abierto: false });
  const [telegramAbierto, setTelegramAbierto] = useState<Cliente | null>(null);
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('clientes', 'crear');
  const puedeEditar = tienePermiso('clientes', 'editar');
  const puedeBorrar = tienePermiso('clientes', 'eliminar');

  // La lista no vuelve a mostrar el esqueleto al recargar: solo en la primera carga.
  const cargar = useCallback(
    () => obtenerClientes().then(setClientes).finally(() => { setCargando(false); setVersion(v => v + 1); }),
    [],
  );

  useEffect(() => { cargar(); }, [cargar]);

  const buscar = useCallback((id: string) => clientes.find(c => c.id === id), [clientes]);

  const handleDesactivar = useCallback(async (id: string) => {
    const c = buscar(id);
    if (!c) return;
    const ok = await confirmar({
      titulo: `Desactivar a "${c.nombre}"`,
      mensaje: 'Dejará de aparecer en los selectores activos, pero su historial se conserva.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarCliente(c.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${c.nombre}" desactivado.`);
    cargar();
  }, [buscar, confirmar, toast, cargar]);

  const handleReactivar = useCallback(async (id: string) => {
    const c = buscar(id);
    if (!c) return;
    const result = await reactivarCliente(c.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${c.nombre}" reactivado.`);
    cargar();
  }, [buscar, toast, cargar]);

  const handleBorrar = useCallback(async (id: string) => {
    const c = buscar(id);
    if (!c) return;
    const ok = await confirmar({
      titulo: `Borrar a "${c.nombre}" definitivamente`,
      mensaje: 'Esta acción es irreversible.',
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarCliente(c.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${c.nombre}" eliminado.`);
    cargar();
  }, [buscar, confirmar, toast, cargar]);

  const generarLinkTelegram = useCallback(async () => {
    if (!telegramAbierto) return { error: 'Sin cliente seleccionado.' };
    return generarLinkTelegramCliente(telegramAbierto.id);
  }, [telegramAbierto]);

  const telegramYaVinculado = useCallback(async () => {
    if (!telegramAbierto) return false;
    const actualizados = await obtenerClientes();
    return actualizados.some(c => c.id === telegramAbierto.id && !!c.telegramChatId);
  }, [telegramAbierto]);

  return (
    <>
      <ListadoTerceros
        tipo="cliente"
        terceros={clientes}
        cargando={cargando}
        version={version}
        puedeCrear={puedeCrear}
        puedeEditar={puedeEditar}
        puedeBorrar={puedeBorrar}
        onNuevo={() => setFormAbierto({ abierto: true, cliente: null })}
        onEditar={id => { const c = buscar(id); if (c) setFormAbierto({ abierto: true, cliente: c }); }}
        onDesactivar={handleDesactivar}
        onReactivar={handleReactivar}
        onBorrar={handleBorrar}
        onVincularTelegram={id => setTelegramAbierto(buscar(id) ?? null)}
      />

      {formAbierto.abierto && (
        <ClienteFormModal
          cliente={formAbierto.cliente}
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

export default ClientesPage;
