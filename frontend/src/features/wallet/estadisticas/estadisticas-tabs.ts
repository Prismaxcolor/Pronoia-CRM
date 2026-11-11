/** Pestañas de Estadísticas y qué datos necesita cada una (para cargar solo lo que se ve). Lógica pura. */

export type ClaveTab = 'saldo' | 'flujo' | 'gastos' | 'informes' | 'activos';

export interface DefTab {
  clave: ClaveTab;
  etiqueta: string;
}

export const TABS: readonly DefTab[] = [
  { clave: 'saldo', etiqueta: 'Saldo' },
  { clave: 'flujo', etiqueta: 'Flujo de caja' },
  { clave: 'gastos', etiqueta: 'Gastos' },
  { clave: 'informes', etiqueta: 'Informes' },
  { clave: 'activos', etiqueta: 'Activos' },
];

export const TAB_POR_DEFECTO: ClaveTab = 'saldo';

/** Pestaña válida a partir del parámetro `t` de la URL; cualquier otra cosa da la pestaña por defecto. */
export function tabDesdeTexto(valor: string | null | undefined): ClaveTab {
  return TABS.find(t => t.clave === (valor ?? '').toLowerCase())?.clave ?? TAB_POR_DEFECTO;
}

/** Las pestañas de movimientos (flujo, gastos, informes) leen el historial; saldo y activos solo las cuentas. */
export const usaMovimientos = (tab: ClaveTab): boolean => tab === 'flujo' || tab === 'gastos' || tab === 'informes';
export const usaCategorias = (tab: ClaveTab): boolean => tab === 'gastos' || tab === 'informes';
export const usaTasas = (tab: ClaveTab): boolean => tab === 'saldo' || tab === 'activos';

export const idTab = (c: ClaveTab): string => `est-tab-${c}`;
export const idPanel = (c: ClaveTab): string => `est-panel-${c}`;

/** El período solo cambia lo que muestran las pestañas de movimientos; Saldo y Activos son los saldos de hoy. */
export const usaPeriodo = usaMovimientos;
