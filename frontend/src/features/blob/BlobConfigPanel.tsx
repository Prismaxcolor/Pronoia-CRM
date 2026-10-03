import { useState } from 'react';
import Switch from '../../components/Switch';
import { BlobCara } from './BlobCara';
import { semillaAleatoria, semillaBlob } from './cara';
import { CONFIG_DEFECTO, ESQUINAS, FRECUENCIAS, PERSONALIDADES_BLOB, TAMANOS, type BlobConfig } from './config';
import { MAX_FRASES_PROPIAS } from './frases';

interface Props {
  config: BlobConfig;
  /** Nombre del usuario logueado: semilla por defecto. */
  nombreUsuario?: string;
  onCambiar: (parcial: Partial<BlobConfig>) => void;
}

const campo = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-400';
const etiqueta = 'block text-xs font-medium text-text-secondary mb-1';

const TEXTO: Record<string, string> = {
  amigable: 'Amigable', sarcastico: 'Sarcástico', formal: 'Formal', misterioso: 'Misterioso',
  pequeno: 'Pequeño', mediano: 'Mediano', grande: 'Grande',
  br: 'Abajo derecha', bl: 'Abajo izquierda', tr: 'Arriba derecha', tl: 'Arriba izquierda',
  nunca: 'Nunca', baja: 'Poco', media: 'Normal', alta: 'Mucho',
};

function Selector<T extends string>({ etiquetaTexto, valor, opciones, onChange }: {
  etiquetaTexto: string; valor: T; opciones: readonly T[]; onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <span className={etiqueta}>{etiquetaTexto}</span>
      <select className={campo} value={valor} onChange={e => onChange(e.target.value as T)}>
        {opciones.map(o => <option key={o} value={o}>{TEXTO[o] ?? o}</option>)}
      </select>
    </label>
  );
}

export function BlobConfigPanel({ config, nombreUsuario, onCambiar }: Props) {
  // Las frases se editan como texto libre y se normalizan al salir del campo.
  const [textoFrases, setTextoFrases] = useState(config.frasesPropias.join('\n'));
  // El nombre se confirma al salir del campo (normalizar en cada tecla impediría escribir espacios).
  const [textoNombre, setTextoNombre] = useState(config.nombre);

  return (
    <div className="space-y-3 text-left">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-hover/50 p-3">
        <BlobCara semilla={semillaBlob(config, nombreUsuario)} expresion="idle" size={72} />
        <div className="flex flex-1 flex-col items-start gap-1.5">
          <p className="text-xs text-text-secondary">
            {config.semilla ? 'Aspecto sorteado' : 'Aspecto según tu nombre de usuario'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onCambiar({ semilla: semillaAleatoria() })}
              className="rounded-md bg-surface-hover px-2 py-1 text-xs text-text-primary hover:bg-border"
            >
              Probar otro
            </button>
            {config.semilla && (
              <button
                type="button"
                onClick={() => onCambiar({ semilla: '' })}
                className="rounded-md px-2 py-1 text-xs text-text-secondary underline hover:text-text-primary"
              >
                Volver al mío
              </button>
            )}
          </div>
        </div>
      </div>

      <label className="block">
        <span className={etiqueta}>Nombre</span>
        <input className={campo} maxLength={20} value={textoNombre} onChange={e => setTextoNombre(e.target.value)} onBlur={() => onCambiar({ nombre: textoNombre })} />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Selector etiquetaTexto="Tamaño" valor={config.tamano} opciones={TAMANOS} onChange={tamano => onCambiar({ tamano })} />
        <Selector etiquetaTexto="Personalidad" valor={config.personalidad} opciones={PERSONALIDADES_BLOB} onChange={personalidad => onCambiar({ personalidad })} />
        <Selector etiquetaTexto="Posición" valor={config.esquina} opciones={ESQUINAS} onChange={esquina => onCambiar({ esquina })} />
      </div>

      <Selector etiquetaTexto="Frases espontáneas" valor={config.frecuencia} opciones={FRECUENCIAS} onChange={frecuencia => onCambiar({ frecuencia })} />

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm text-text-primary">
          Conversar con IA
          <span className="block text-xs text-text-muted">Apagado = solo reacciones. Con IA, tus mensajes salen a un servicio externo.</span>
        </span>
        <Switch checked={config.iaActiva} onChange={iaActiva => onCambiar({ iaActiva })} />
      </label>

      <label className="block">
        <span className={etiqueta}>Mis frases (una por línea, máx. {MAX_FRASES_PROPIAS})</span>
        <textarea
          className={`${campo} resize-none`}
          rows={3}
          value={textoFrases}
          placeholder="¡Qué buen peso!"
          onChange={e => setTextoFrases(e.target.value)}
          onBlur={() => {
            const lineas = textoFrases.split('\n');
            onCambiar({ frasesPropias: lineas });
            // Reflejar lo normalizado (recortes, vacíos) lo hace el padre al guardar.
            setTextoFrases(lineas.map(l => l.trim()).filter(Boolean).slice(0, MAX_FRASES_PROPIAS).join('\n'));
          }}
        />
      </label>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          className="text-xs text-text-secondary underline hover:text-text-primary"
          onClick={() => { onCambiar({ ...CONFIG_DEFECTO, esquina: config.esquina }); setTextoFrases(''); setTextoNombre(CONFIG_DEFECTO.nombre); }}
        >
          Restablecer
        </button>
        <button
          type="button"
          className="rounded-md bg-surface-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-border"
          onClick={() => onCambiar({ modo: 'minimizado' })}
        >
          Minimizar a BLOB
        </button>
      </div>
    </div>
  );
}
