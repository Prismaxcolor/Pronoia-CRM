import { useState } from 'react';
import Switch from '../../components/Switch';
import {
  BOCAS, COLORES_BLOB, CONFIG_DEFECTO, ESQUINAS, FORMAS, FRECUENCIAS, OJOS, PERSONALIDADES_BLOB, TAMANOS,
  type BlobConfig,
} from './config';
import { MAX_FRASES_PROPIAS } from './frases';

interface Props {
  config: BlobConfig;
  onCambiar: (parcial: Partial<BlobConfig>) => void;
}

const campo = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-400';
const etiqueta = 'block text-xs font-medium text-text-secondary mb-1';

const TEXTO: Record<string, string> = {
  gota: 'Gota', redondo: 'Redondo', cuadrado: 'Cuadrado', triangulo: 'Triángulo',
  normales: 'Normales', grandes: 'Grandes', chiquitos: 'Chiquitos', gafas: 'Gafas',
  sonrisa: 'Sonrisa', boquita: 'Boquita', neutra: 'Neutra', dientes: 'Dientes',
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

export function BlobConfigPanel({ config, onCambiar }: Props) {
  // Las frases se editan como texto libre y se normalizan al salir del campo.
  const [textoFrases, setTextoFrases] = useState(config.frasesPropias.join('\n'));
  // El nombre se confirma al salir del campo (normalizar en cada tecla impediría escribir espacios).
  const [textoNombre, setTextoNombre] = useState(config.nombre);

  return (
    <div className="space-y-3 text-left">
      <label className="block">
        <span className={etiqueta}>Nombre</span>
        <input className={campo} maxLength={20} value={textoNombre} onChange={e => setTextoNombre(e.target.value)} onBlur={() => onCambiar({ nombre: textoNombre })} />
      </label>

      <div>
        <span className={etiqueta}>Color</span>
        <div className="flex items-center gap-2 flex-wrap">
          {COLORES_BLOB.map(c => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={config.color.toLowerCase() === c.toLowerCase()}
              onClick={() => onCambiar({ color: c })}
              className={`h-6 w-6 rounded-full border-2 ${config.color.toLowerCase() === c.toLowerCase() ? 'border-text-primary' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            aria-label="Color personalizado"
            value={config.color}
            onChange={e => onCambiar({ color: e.target.value })}
            className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Selector etiquetaTexto="Forma" valor={config.forma} opciones={FORMAS} onChange={forma => onCambiar({ forma })} />
        <Selector etiquetaTexto="Ojos" valor={config.ojos} opciones={OJOS} onChange={ojos => onCambiar({ ojos })} />
        <Selector etiquetaTexto="Boca" valor={config.boca} opciones={BOCAS} onChange={boca => onCambiar({ boca })} />
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
