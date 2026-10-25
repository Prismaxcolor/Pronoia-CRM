/** Lógica pura de la pantalla de perfil y del bloque de usuario del menú. */

export type RolPerfil = 'superadmin' | 'administracion' | 'trabajador';

const ETIQUETAS_ROL: Record<string, string> = {
  superadmin: 'Superadmin',
  administracion: 'Administración',
  trabajador: 'Trabajador',
};

/** Texto legible del rol (si llega un rol desconocido, se muestra tal cual). */
export function etiquetaRol(rol: string | null | undefined): string {
  if (!rol) return '';
  return ETIQUETAS_ROL[rol] ?? rol;
}

/** Hasta dos iniciales en mayúscula (primera y última palabra del nombre); '?' si no hay nombre. */
export function iniciales(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  const primera = palabras[0].charAt(0);
  const ultima = palabras.length > 1 ? palabras[palabras.length - 1].charAt(0) : '';
  return (primera + ultima).toLocaleUpperCase('es');
}

export interface EntradaAvisos {
  hayVersionNueva: boolean;
  esSuperadmin: boolean;
  telegramVinculado: boolean;
  pendientes: number;
  rechazadas: number;
}

export type MotivoAviso = 'version-nueva' | 'telegram' | 'pendientes' | 'rechazadas';

/** Motivos por los que el perfil tiene algo que atender (vacío = sin punto de aviso). */
export function motivosDeAviso(e: EntradaAvisos): MotivoAviso[] {
  const motivos: MotivoAviso[] = [];
  if (e.hayVersionNueva) motivos.push('version-nueva');
  if (e.esSuperadmin && !e.telegramVinculado) motivos.push('telegram');
  if (e.pendientes > 0) motivos.push('pendientes');
  if (e.rechazadas > 0) motivos.push('rechazadas');
  return motivos;
}

export const TEXTO_AVISO: Record<MotivoAviso, string> = {
  'version-nueva': 'Hay una versión nueva de Pronoia disponible.',
  telegram: 'Vincula tu Telegram para recibir las solicitudes de llave.',
  pendientes: 'Tienes operaciones pendientes de envío.',
  rechazadas: 'Hay operaciones rechazadas que requieren tu atención.',
};
