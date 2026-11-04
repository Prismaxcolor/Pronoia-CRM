import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';

interface Props {
  pesoEntrada: number;
  totalSalidas: number;
  /** Etiqueta de la última línea: "Merma", "Restante" o "Excedente". */
  etiquetaResto: string;
  /** Valor que se muestra en la última línea. */
  valorResto: number;
  /** Pinta la última línea en rojo (la merma o el restante quedó negativo). */
  restoNegativo: boolean;
}

/** Resumen de un formulario de completar: entrada, salidas y lo que queda. */
function ResumenSalidasCard({ pesoEntrada, totalSalidas, etiquetaResto, valorResto, restoNegativo }: Props) {
  return (
    <div className="bg-surface-alt rounded-lg p-3 mb-4 text-xs space-y-1 border border-border">
      <div className="flex justify-between text-text-secondary"><span>Entrada total</span><span className="font-medium">{formatearKgPesaje(pesoEntrada)} kg</span></div>
      <div className="flex justify-between text-text-secondary"><span>Salidas totales</span><span className="font-medium">{formatearKgPesaje(totalSalidas)} kg</span></div>
      <div className={`flex justify-between font-medium ${restoNegativo ? 'text-red-600' : 'text-text-muted'}`}>
        <span>{etiquetaResto}</span><span>{formatearKgPesaje(valorResto)} kg</span>
      </div>
    </div>
  );
}

export default ResumenSalidasCard;
