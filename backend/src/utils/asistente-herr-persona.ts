/**
 * Herramientas de BLOB para cuando el usuario nombra a una persona SIN decir si es proveedor o
 * cliente: buscan en ambos lados internamente y devuelven SOLO donde existe. Así el modelo no
 * recibe resultados vacíos del "otro lado" (y no los menciona) y "Consulté:" muestra una sola cosa.
 *
 * Permisos: basta con proveedores:ver o clientes:ver, y cada lado se consulta solo si la persona
 * lo puede ver; del lado sin permiso no se consulta ni se insinúa nada.
 */
import { z } from 'zod';
import {
  definirHerramienta,
  limiteEfectivo,
  limiteSchema,
  patronBusqueda,
  textoSeguro,
  type ContextoHerramienta,
  type HerramientaAsistente,
} from './asistente-herr-base.js';
import {
  PERFIL_CLIENTE,
  PERFIL_PROVEEDOR,
  estadoDeCuentaDe,
  resolverEntidad,
  sugerenciasDeNombre,
  todosLosNombres,
  type Perfil,
} from './asistente-herr-dinero.js';
import { supabaseAdmin } from '../config/supabase.js';
import { coincidePorPalabras } from './asistente-similitud.js';

const MAX_SUGERENCIAS = 5;
const MAX_EJEMPLOS = 8;

const nombreLado = (perfiles: readonly Perfil[], plural: boolean): string =>
  perfiles.map(p => (plural ? p.plural : p.singular)).join(' y ');

/** Los lados (proveedor/cliente) que esta persona puede consultar. */
function ladosPermitidos(ctx: ContextoHerramienta): Perfil[] {
  return [PERFIL_PROVEEDOR, PERFIL_CLIENTE].filter(p => ctx.puede(p.permiso));
}

/** Parecidos y ejemplos de los lados permitidos, sin decir de qué lado vienen. */
async function sugerenciasDe(lados: readonly Perfil[], nombre: string): Promise<{ parecidos: string[]; ejemplos: string[] }> {
  const porLado = await Promise.all(lados.map(p => sugerenciasDeNombre(p, nombre)));
  const unicos = (xs: string[], max: number) => [...new Set(xs)].slice(0, max);
  return {
    parecidos: unicos(porLado.flatMap(s => s.parecidos), MAX_SUGERENCIAS),
    ejemplos: unicos(porLado.flatMap(s => s.ejemplos), MAX_EJEMPLOS),
  };
}

const personaSchema = z.object({ nombre: z.string().min(1).max(60).describe('Nombre (o parte) de la persona o empresa, tal como lo dijo el usuario.') });

export const saldoPersona = definirHerramienta({
  nombre: 'saldo_persona',
  etiqueta: 'saldos por nombre',
  descripcion:
    'Estado de cuenta (USD) de una persona o empresa cuando el usuario NO dice si es proveedor o cliente ("saldo de X", "qué saldo tiene X", "cuánto hay con X"). Busca en proveedores y clientes por dentro y devuelve SOLO donde existe: responde en esos términos y NUNCA menciones el lado donde no aparece. Si existe en ambos trae los dos saldos rotulados por "rol". saldoUsd de un proveedor positivo = le debemos, negativo = saldo a nuestro favor; de un cliente positivo = nos debe. Si el usuario dice "debemos/compramos" usa saldo_proveedor; si dice "nos deben/vendimos" usa saldo_cliente.',
  parametros: personaSchema,
  permisos: [],
  permisosAlguno: [PERFIL_PROVEEDOR.permiso, PERFIL_CLIENTE.permiso],
  async ejecutar({ nombre }, ctx) {
    const lados = ladosPermitidos(ctx);
    const resueltos = await Promise.all(lados.map(async perfil => ({ perfil, ...(await resolverEntidad(perfil, nombre)) })));
    const hallados = resueltos.filter(r => r.elegida);
    const ambiguos = resueltos.filter(r => !r.elegida && r.opciones.length > 0);

    if (hallados.length === 0 && ambiguos.length === 0) {
      return {
        filas: 0,
        etiqueta: `estado de cuenta de ${nombreLado(lados, false).replace(' y ', ' o ')}`,
        datos: { fuente: 'estado de cuenta', error: 'No encontré a nadie con ese nombre.', ...(await sugerenciasDe(lados, nombre)) },
      };
    }
    if (hallados.length === 0) {
      return {
        filas: 0,
        etiqueta: `estado de cuenta de ${nombreLado(ambiguos.map(a => a.perfil), false)}`,
        datos: {
          fuente: 'estado de cuenta',
          error: 'Hay varios con ese nombre; pregunta cuál.',
          posibles: ambiguos.flatMap(a => a.opciones.map(o => ({ nombre: o, rol: a.perfil.singular }))),
        },
      };
    }

    const estados = await Promise.all(hallados.map(h => estadoDeCuentaDe(h.perfil, h.elegida!.id)));
    const coincidencias = estados.map((e, i) => {
      const { fuente: _f, moneda: _m, [hallados[i]!.perfil.singular]: nombrePersona, ...resto } = e.datos as Record<string, unknown>;
      return { rol: hallados[i]!.perfil.singular, nombre: nombrePersona ?? textoSeguro(hallados[i]!.elegida!.nombre), ...resto };
    });
    return {
      filas: estados.reduce((a, e) => a + e.filas, 0),
      etiqueta: `estado de cuenta de ${nombreLado(hallados.map(h => h.perfil), false)}`,
      datos: {
        fuente: 'estado de cuenta',
        moneda: 'USD',
        coincidencias,
        ...(coincidencias.length > 1 ? { nota: 'Existe como proveedor y como cliente: da cada saldo con su rol, bien rotulado.' } : {}),
      },
    };
  },
});

async function buscarEnLado(p: Perfil, nombre: string, limite: number) {
  const { data } = await supabaseAdmin.from(p.tabla).select('nombre, activo').ilike('nombre', patronBusqueda(nombre)).order('nombre').limit(limite);
  let encontrados = (data ?? []) as Array<{ nombre: string; activo?: boolean }>;
  if (encontrados.length === 0) {
    encontrados = (await todosLosNombres(p)).filter(f => coincidePorPalabras(f.nombre, nombre)).slice(0, limite);
  }
  return encontrados.map(r => ({ nombre: textoSeguro(r.nombre), rol: p.singular, activo: r.activo !== false }));
}

export const buscarPersona = definirHerramienta({
  nombre: 'buscar_persona',
  etiqueta: 'búsqueda por nombre',
  descripcion:
    'Busca por nombre aproximado a una persona o empresa SIN saber si es proveedor o cliente. Devuelve solo las coincidencias (con su "rol"): nombre y si está activo, sin datos de contacto. Úsala para confirmar cómo se escribe un nombre. Nunca menciones el lado donde no aparece.',
  parametros: z.object({ nombre: personaSchema.shape.nombre, limite: limiteSchema }),
  permisos: [],
  permisosAlguno: [PERFIL_PROVEEDOR.permiso, PERFIL_CLIENTE.permiso],
  async ejecutar({ nombre, limite }, ctx) {
    const lados = ladosPermitidos(ctx);
    const porLado = await Promise.all(lados.map(async p => ({ p, filas: await buscarEnLado(p, nombre, limiteEfectivo(limite)) })));
    const conFilas = porLado.filter(l => l.filas.length > 0);
    const coincidencias = conFilas.flatMap(l => l.filas);
    const etiquetaLados = conFilas.length > 0 ? conFilas.map(l => l.p) : lados;
    return {
      filas: coincidencias.length,
      etiqueta: nombreLado(etiquetaLados, true),
      datos: {
        fuente: 'búsqueda por nombre',
        coincidencias,
        ...(coincidencias.length === 0 ? await sugerenciasDe(lados, nombre) : {}),
      },
    };
  },
});

export const HERRAMIENTAS_PERSONA: readonly HerramientaAsistente[] = [saldoPersona, buscarPersona];
