import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { obtenerNominaSemana } from '../../services/nomina-service';
import { ControlSegmentado, SkeletonBloque } from '../../components/ui';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { formatearFecha } from '../../lib/formato';
import { ETIQUETA_TIPO_TRABAJADOR, TIPOS_TRABAJADOR, type NominaSemana, type TipoTrabajador } from '@shared/types/nomina';
import { domingoDe, lunesDe, type TotalesNomina } from '@shared/types/nomina-calculo';
import NominaEditor from './NominaEditor';
import { desplazarSemana } from './nomina-editor';

interface Datos {
  semana: NominaSemana;
  totalesOtroTipo: TotalesNomina | null;
}

const OTRO_TIPO: Record<TipoTrabajador, TipoTrabajador> = { ADMINISTRATIVO: 'OPERATIVO', OPERATIVO: 'ADMINISTRATIVO' };
const OPCIONES = TIPOS_TRABAJADOR.map(t => ({ valor: t, etiqueta: ETIQUETA_TIPO_TRABAJADOR[t] }));

/** Nómina semanal: cada tipo de personal se carga por separado; la semana se identifica por su lunes. */
function NominaSemanalPanel() {
  const [tipo, setTipo] = useState<TipoTrabajador>('OPERATIVO');
  const [semana, setSemana] = useState(() => lunesDe(hoyNegocio()));
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [actual, otra] = await Promise.all([obtenerNominaSemana(tipo, semana), obtenerNominaSemana(OTRO_TIPO[tipo], semana)]);
    if ('error' in actual) setError(actual.error);
    else {
      setDatos({ semana: actual, totalesOtroTipo: !('error' in otra) && otra.nomina ? otra.nomina.totales : null });
      setError(null);
    }
    setCargando(false);
  }, [tipo, semana]);

  useEffect(() => {
    // Carga inicial y al cambiar tipo o semana: el estado se actualiza tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const cambiar = (nuevoTipo: TipoTrabajador, nuevaSemana: string) => {
    setCargando(true);
    setDatos(null);
    setTipo(nuevoTipo);
    setSemana(nuevaSemana);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ControlSegmentado opciones={OPCIONES} valor={tipo} onCambiar={t => cambiar(t, semana)} etiquetaAria="Tipo de personal de la nómina" />
        <div className="flex items-center gap-1" role="group" aria-label="Semana de la nómina">
          <button type="button" aria-label="Semana anterior" onClick={() => cambiar(tipo, desplazarSemana(semana, -1))} className="rounded-lg border border-border p-2 hover:bg-surface-hover"><ChevronLeft size={16} /></button>
          <label className="sr-only" htmlFor="nomina-semana">Elige cualquier día de la semana</label>
          <input
            id="nomina-semana" type="date" value={semana}
            onChange={e => e.target.value && cambiar(tipo, lunesDe(e.target.value))}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <button type="button" aria-label="Semana siguiente" onClick={() => cambiar(tipo, desplazarSemana(semana, 1))} className="rounded-lg border border-border p-2 hover:bg-surface-hover"><ChevronRight size={16} /></button>
        </div>
        <p className="text-sm text-text-secondary">Semana del {formatearFecha(semana)} (lunes) al {formatearFecha(domingoDe(semana))} (domingo)</p>
      </div>

      {cargando ? <SkeletonBloque /> : error ? (
        <div role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm text-red-500">
          {error}
          <button type="button" onClick={() => { setCargando(true); void cargar(); }} className="ml-3 underline">Reintentar</button>
        </div>
      ) : datos && (
        <NominaEditor
          key={`${tipo}-${semana}-${datos.semana.nomina?.id ?? 'nueva'}-${datos.semana.nomina?.version ?? 0}-${datos.semana.nomina?.estado ?? ''}`}
          tipo={tipo} semana={semana} nomina={datos.semana.nomina} candidatos={datos.semana.candidatos}
          totalesOtroTipo={datos.totalesOtroTipo}
          onRecargar={async () => { await cargar(); }}
        />
      )}
    </div>
  );
}

export default NominaSemanalPanel;
