import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import type { ArchivoPdf, ModoPdf } from '../../../services/pdf-documento';
import { useToast } from '../../../hooks/use-toast-context';

interface Props {
  generar: (modo: ModoPdf) => Promise<ArchivoPdf | undefined>;
}

const BOTON = 'flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Descargar el PDF o abrirlo en otra pestaña para imprimirlo. */
function AccionesReporte({ generar }: Props) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);

  const descargar = async () => {
    setOcupado(true);
    try { await generar('descargar'); } catch { toast.errorMsg('No se pudo generar el PDF.'); }
    setOcupado(false);
  };

  const imprimir = async () => {
    // La pestaña se abre antes de generar el PDF para que el navegador no la bloquee como ventana emergente.
    const ventana = window.open('', '_blank');
    setOcupado(true);
    try {
      const archivo = await generar('blob');
      if (archivo && ventana) ventana.location.href = URL.createObjectURL(archivo.blob);
      else ventana?.close();
    } catch {
      ventana?.close();
      toast.errorMsg('No se pudo generar el PDF.');
    }
    setOcupado(false);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BOTON} onClick={descargar} disabled={ocupado}><Download size={16} aria-hidden="true" />Descargar PDF</button>
      <button type="button" className={BOTON} onClick={imprimir} disabled={ocupado}><Printer size={16} aria-hidden="true" />Ver e imprimir</button>
    </div>
  );
}

export default AccionesReporte;
