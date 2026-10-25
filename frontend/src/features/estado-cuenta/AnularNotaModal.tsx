import { anularNotaAjuste } from '../../services/nota-ajuste-service';
import { anularNotaAjusteCliente } from '../../services/nota-ajuste-cliente-service';
import type { EntradaEstadoCuenta, TipoEntidad } from '../../services/estado-cuenta-service';
import AnularConLlaveModal from '../../components/AnularConLlaveModal';

interface Props {
  tipoEntidad: TipoEntidad;
  entidadId: string;
  nota: EntradaEstadoCuenta;
  onClose: () => void;
  onAnulada: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Anular nota, compartida entre proveedor y cliente (Bloque 45). Exige llave de edición salvo superadmin. */
function AnularNotaModal({ tipoEntidad, entidadId, nota, onClose, onAnulada }: Props) {
  const monto = nota.tipo === 'nota_debito' ? nota.cargo : nota.abono;

  const confirmar = async (motivo: string, llave: string): Promise<string | null> => {
    if (!nota.notaId) return 'Nota inválida.';
    const result = tipoEntidad === 'proveedor'
      ? await anularNotaAjuste(entidadId, nota.notaId, motivo, llave)
      : await anularNotaAjusteCliente(entidadId, nota.notaId, motivo, llave);
    if ('error' in result) return result.error;
    onAnulada();
    return null;
  };

  return (
    <AnularConLlaveModal
      titulo="Anular nota"
      entidadTipo={tipoEntidad === 'proveedor' ? 'nota_ajuste_proveedor' : 'nota_ajuste_cliente'}
      entidadId={nota.notaId ?? ''}
      etiquetaBoton="Anular nota"
      onConfirmar={confirmar}
      onClose={onClose}
    >
      <div className="bg-surface-alt border border-border rounded-lg p-3 text-sm">
        <p className="text-text-secondary">{nota.tipo === 'nota_debito' ? 'Nota de débito' : 'Nota de crédito'} · ${fmt(monto)}</p>
        <p className="text-text-primary mt-1">{nota.descripcion}</p>
      </div>
      <p className="text-xs text-text-muted">
        La nota queda marcada como anulada en el historial y deja de afectar el saldo del estado de cuenta. No se crea ninguna nota nueva. No se puede anular una nota que ya fue aplicada a un pago o cobro: anula primero ese pago o cobro.
      </p>
    </AnularConLlaveModal>
  );
}

export default AnularNotaModal;
