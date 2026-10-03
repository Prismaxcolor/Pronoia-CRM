/**
 * Registro de "herramientas" del asistente BLOB — VACÍO a propósito.
 *
 * Idea futura: dejar que la IA consulte datos del sistema (function calling) y
 * responda con información real. Cada herramienta debería:
 *   - declarar el permiso requerido (reutilizar `tienePermiso` de utils/permisos),
 *   - ejecutarse con el usuario de la sesión (nunca con service key a ciegas),
 *   - devolver solo lo mínimo necesario y NO enviar al proveedor externo datos
 *     sensibles sin decisión explícita (ver sección de privacidad en docs).
 *
 * Ejemplo (NO implementado):
 *
 *   {
 *     nombre: 'consultar_stock',
 *     descripcion: 'Devuelve el stock actual de un producto por nombre.',
 *     permiso: { recurso: 'productos', accion: 'ver' },
 *     parametros: { type: 'object', properties: { producto: { type: 'string' } } },
 *     ejecutar: async (args, usuario) => { ... },
 *   }
 */
export interface HerramientaAsistente {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los parámetros. */
  parametros: Record<string, unknown>;
  ejecutar: (args: Record<string, unknown>, usuarioId: string) => Promise<unknown>;
}

export const HERRAMIENTAS_ASISTENTE: readonly HerramientaAsistente[] = [];
