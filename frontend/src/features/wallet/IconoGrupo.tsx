import { Coins, Landmark, Network, PiggyBank, Wallet, type LucideIcon } from 'lucide-react';
import type { GrupoWallet } from '@shared/types/index.js';
import { defGrupo } from './wallet-grupos';
import type { ColorCuenta } from './wallet-cuentas-logica';

const ICONOS: Record<GrupoWallet, LucideIcon> = {
  efectivo: Coins,
  corriente: Landmark,
  ahorros: PiggyBank,
  inversiones: Network,
  general: Wallet,
};

interface Props {
  grupo: GrupoWallet;
  /** Imagen propia de la cuenta (logo o foto de la caja); si no hay, se usa el ícono del grupo. */
  imagenUrl?: string | null;
  /** Lado del cuadrado en px. */
  tamano?: number;
  /** Color propio de la cuenta (bancas.color); si falta se usa el del grupo. */
  colorPropio?: ColorCuenta;
}

/** Cuadrado de color con el ícono del grupo de la cuenta (o su imagen). Decorativo: el nombre va siempre en texto. */
function IconoGrupo({ grupo, imagenUrl, tamano = 56, colorPropio }: Props) {
  const def = defGrupo(grupo);
  const fondo = colorPropio?.color ?? def.color;
  const oscuro = colorPropio ? colorPropio.textoOscuro : def.textoOscuro;
  const Icono = ICONOS[grupo];
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl"
      style={{ width: tamano, height: tamano, backgroundColor: fondo, color: oscuro ? '#1F1F1F' : '#FFFFFF' }}
    >
      {imagenUrl
        ? <img src={imagenUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        : <Icono size={Math.round(tamano * 0.5)} strokeWidth={2} />}
    </span>
  );
}

export default IconoGrupo;
