interface Props {
  label: string;
  valor: string;
  /** Si viene, el valor se muestra como link clickeable (ej. ir a la factura
   *  asociada) en vez de texto plano. No se imprime como botón (print:no-underline). */
  onClick?: () => void;
}

/** Fila label/valor de las vistas tipo "ticket" (facturas, notas de crédito/débito):
 *  previsualización en pantalla + impresión. Compartida entre FacturaDetallePage
 *  y NotaDetallePage. */
function FilaDocumento({ label, valor, onClick }: Props) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-b-0 print:border-black">
      <span className="text-text-secondary text-sm">{label}</span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="text-brand-600 hover:underline text-sm font-medium text-right print:text-inherit print:no-underline"
        >
          {valor}
        </button>
      ) : (
        <span className="text-text-primary text-sm font-medium text-right">{valor}</span>
      )}
    </div>
  );
}

export default FilaDocumento;
