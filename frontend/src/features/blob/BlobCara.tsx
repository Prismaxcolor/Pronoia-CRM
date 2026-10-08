import type { Ref } from 'react';
import { Blobatar } from '@blobatar/react';
import { happy, idle, mad, sick, sleepy, surprised, thinking, wink, love } from 'blobatar/expression';
import 'blobatar/motion.css';
import 'blobatar/gaze.css';
import type { NombreExpresion } from './cara';

const EXPRESIONES = { idle, happy, mad, sick, sleepy, surprised, thinking, wink, love } as const;

interface Props {
  /** Semilla de la librería: de ella salen silueta, colores y rasgos. */
  semilla: string;
  expresion: NombreExpresion;
  size: number;
  /** Ref de `useGaze` para que los ojos sigan el cursor. */
  gazeRef?: Ref<SVGSVGElement>;
}

/** La cara de BLOB: un `<Blobatar>` con la configuración de fábrica de la librería, animado. */
export function BlobCara({ semilla, expresion, size, gazeRef }: Props) {
  const expr = expresion in EXPRESIONES ? EXPRESIONES[expresion as keyof typeof EXPRESIONES] : idle;
  return <Blobatar ref={gazeRef} name={semilla} size={size} animate="always" expression={expr} className="block" />;
}
