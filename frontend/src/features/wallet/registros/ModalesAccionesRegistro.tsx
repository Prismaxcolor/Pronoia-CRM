import type { Banca, CategoriaWallet, Movimiento } from '@shared/types/index.js';
import AnularConLlaveModal from '../../../components/AnularConLlaveModal';
import { useToast } from '../../../hooks/use-toast-context';
import { MONTO_OCULTO } from '../wallet-grupos';
import { anularMovimiento } from '../../../services/transaccion-edicion-service';
import EditarMovimientoModal from '../../cochinito/EditarMovimientoModal';
import CobrarTransferenciaModal from '../../cochinito/CobrarTransferenciaModal';
import CambiarCategoriaModal from '../../cochinito/categorias/CambiarCategoriaModal';
import type { ClaveAccion } from './registros-acciones';
import { movimientoConMontoOculto, textoLibreSegunPrivacidad } from './registros-privacidad';

export interface AccionEnCurso {
  clave: Extract<ClaveAccion, 'editar' | 'anular' | 'categoria' | 'cobrar'>;
  movimiento: Movimiento;
}

interface Props {
  accion: AccionEnCurso | null;
  bancas: readonly Banca[];
  categorias: readonly CategoriaWallet[];
  indiceCategorias: ReadonlyMap<string, CategoriaWallet>;
  /** Privacidad de la Wallet nueva: el resumen del modal de anular enmascara el monto igual que la lista. */
  ocultarCantidades: boolean;
  cuentasOcultas: ReadonlySet<string>;
  onCerrar: () => void;
  /** La acción se hizo: quien abre recarga la lista. El aviso (toast) ya lo mostró este componente. */
  onHecho: () => void;
}

const formatoMonto = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2 });

/**
 * Los mismos modales de la Wallet clásica (editar, anular con llave, cambiar categoría, cobrar transferencia de mesa)
 * abiertos desde el menú de una fila de Registros. Tras cada acción avisa con un toast y pide recargar.
 */
function ModalesAccionesRegistro({ accion, bancas, categorias, indiceCategorias, ocultarCantidades, cuentasOcultas, onCerrar, onHecho }: Props) {
  const toast = useToast();
  if (!accion) return null;
  const m = accion.movimiento;
  const terminar = (mensaje: string, advertencia?: string) => {
    onCerrar();
    if (advertencia) toast.errorMsg(advertencia); else toast.exito(mensaje);
    onHecho();
  };

  if (accion.clave === 'editar') {
    return <EditarMovimientoModal movimiento={m} bancas={bancas} onClose={onCerrar} onGuardado={(_mov, advertencia) => terminar('Movimiento actualizado.', advertencia)} />;
  }
  if (accion.clave === 'categoria') {
    return <CambiarCategoriaModal movimiento={m} categorias={categorias} indice={indiceCategorias} onClose={onCerrar} onGuardado={() => terminar('Categoría actualizada.')} />;
  }
  if (accion.clave === 'cobrar') {
    return <CobrarTransferenciaModal movimiento={m} bancaDestino={bancas.find(b => b.id === m.bancaDestinoId)} onClose={onCerrar} onCobrado={() => terminar('Transferencia actualizada.')} />;
  }
  const ocultar = movimientoConMontoOculto({ ocultarCantidades, cuentasOcultas }, m);
  const resumenMonto = ocultar ? MONTO_OCULTO : `${m.moneda} ${formatoMonto(m.monto)}`;
  return (
    <AnularConLlaveModal
      titulo="Anular movimiento"
      entidadTipo="movimiento_banca"
      entidadId={m.id}
      etiquetaBoton="Anular movimiento"
      onClose={onCerrar}
      onConfirmar={async (motivo, llave) => {
        const r = await anularMovimiento(m.id, motivo, llave);
        if ('error' in r) return r.error;
        terminar('Movimiento anulado.');
        return null;
      }}
    >
      <div className="rounded-lg border border-border bg-surface-alt p-3 text-sm">
        <p className="font-medium text-text-primary">{textoLibreSegunPrivacidad(m.descripcion || 'Movimiento sin concepto', ocultar)}</p>
        <p className="text-text-secondary">{resumenMonto} · {m.fecha.slice(0, 10)}</p>
      </div>
      <p className="text-xs text-text-muted">
        El saldo de la cuenta se corrige y el movimiento queda marcado como anulado en el historial (no se borra). Se rechaza si alguna cuenta quedaría sin fondos.
      </p>
    </AnularConLlaveModal>
  );
}

export default ModalesAccionesRegistro;
