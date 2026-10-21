import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { EncabezadoPagina, Pestanas } from '../../components/ui';
import NominaSemanalPanel from './NominaSemanalPanel';
import PersonalPanel from './PersonalPanel';
import PrestamosPanel from './PrestamosPanel';

type Seccion = 'semanal' | 'administrativo' | 'operativo' | 'prestamos';

const PESTANAS = [
  { valor: 'semanal', etiqueta: 'Nómina semanal' },
  { valor: 'administrativo', etiqueta: 'Personal administrativo' },
  { valor: 'operativo', etiqueta: 'Personal operativo' },
  { valor: 'prestamos', etiqueta: 'Préstamos y adelantos' },
] as const;

function NominaPage() {
  const [seccion, setSeccion] = useState<Seccion>('semanal');
  return (
    <div>
      <EncabezadoPagina
        titulo="Nómina"
        subtitulo="Personal administrativo y operativo, nómina semanal por tipo de personal y préstamos o adelantos. Solo registra y calcula: no mueve dinero."
      />
      <p className="mb-4 flex items-start gap-2 rounded-lg bg-surface-alt p-3 text-xs text-text-secondary">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        Esta sección guarda datos personales (cédula, teléfono, dirección, datos de pago). Solo la ven quienes tienen el permiso de Nómina.
      </p>
      <Pestanas pestanas={PESTANAS} valor={seccion} onCambiar={setSeccion} etiquetaAria="Secciones de la nómina">
        {seccion === 'semanal' && <NominaSemanalPanel />}
        {seccion === 'administrativo' && <PersonalPanel tipo="ADMINISTRATIVO" />}
        {seccion === 'operativo' && <PersonalPanel tipo="OPERATIVO" />}
        {seccion === 'prestamos' && <PrestamosPanel />}
      </Pestanas>
    </div>
  );
}

export default NominaPage;
