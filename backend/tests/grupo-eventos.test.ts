import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CATALOGO_EVENTOS, buscarEvento, debeNotificar, resolverVariante, type ContextoEvento,
} from '../src/services/grupo-eventos.js';
import {
  esClaveSensible, sanitizarValor, escaparHtml, formatearCambios, formatearMensaje,
} from '../src/utils/grupo-formato.js';

const SRC = path.resolve(import.meta.dirname, '../src');

/** Rutas mutantes reales: método + ruta completa, leyendo routes/*.ts y los montajes de app.ts. */
function rutasMutantesReales(): string[] {
  const app = readFileSync(path.join(SRC, 'app.ts'), 'utf8');
  const importes = new Map<string, string>(); // variable -> archivo
  for (const m of app.matchAll(/import (\w+) from '\.\/routes\/([\w-]+)\.js'/g)) importes.set(m[1], m[2]);
  const montajes = new Map<string, string>(); // archivo -> prefijo
  for (const m of app.matchAll(/app\.use\('([^']+)',\s*(\w+)\)/g)) {
    const archivo = importes.get(m[2]);
    if (archivo) montajes.set(archivo, m[1]);
  }
  const out: string[] = [];
  for (const f of readdirSync(path.join(SRC, 'routes'))) {
    const archivo = f.replace(/\.ts$/, '');
    const prefijo = montajes.get(archivo);
    if (prefijo === undefined) continue;
    const codigo = readFileSync(path.join(SRC, 'routes', f), 'utf8');
    for (const m of codigo.matchAll(/router\.(post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
      const ruta = m[2] === '/' ? prefijo : `${prefijo}${m[2]}`;
      out.push(`${m[1].toUpperCase()} ${ruta}`);
    }
  }
  return out;
}

describe('catálogo de eventos del grupo', () => {
  it('cubre TODAS las rutas mutantes del backend (si se agrega una ruta, hay que catalogarla)', () => {
    const reales = rutasMutantesReales();
    expect(reales.length).toBeGreaterThan(80);
    const catalogadas = new Set(CATALOGO_EVENTOS.map(e => `${e.metodo} ${e.ruta}`));
    const faltantes = reales.filter(r => !catalogadas.has(r));
    expect(faltantes).toEqual([]);
  });

  it('no tiene filas que apunten a rutas inexistentes', () => {
    const reales = new Set(rutasMutantesReales());
    const sobrantes = CATALOGO_EVENTOS.filter(e => !reales.has(`${e.metodo} ${e.ruta}`)).map(e => e.clave);
    expect(sobrantes).toEqual([]);
  });

  it('claves y método+ruta son únicos', () => {
    const claves = CATALOGO_EVENTOS.map(e => e.clave);
    expect(new Set(claves).size).toBe(claves.length);
    const rutas = CATALOGO_EVENTOS.map(e => `${e.metodo} ${e.ruta}`);
    expect(new Set(rutas).size).toBe(rutas.length);
  });

  it('borrados, anulaciones, usuarios, llaves y cierres de toma física son críticos', () => {
    for (const e of CATALOGO_EVENTOS) {
      if (e.metodo === 'DELETE' && !e.ruta.includes('/pesajes') && !e.ruta.includes('/precios')) {
        expect(e.importancia, e.clave).toBe('critica');
      }
    }
    const criticos = ['ticket.editado', 'llave.generada', 'toma_fisica.culminada', 'toma_fisica.cancelada', 'pago.multiple', 'cobro.multiple', 'usuario.editado', 'proveedor.nota_anulada'];
    for (const clave of criticos) {
      expect(CATALOGO_EVENTOS.find(e => e.clave === clave)?.importancia, clave).toBe('critica');
    }
  });

  it('login, registro, portal y subidas son ignorables', () => {
    for (const clave of ['auth.login', 'auth.registro', 'portal.login', 'portal.verificar', 'portal.logout', 'uploads.subida']) {
      expect(CATALOGO_EVENTOS.find(e => e.clave === clave)?.importancia, clave).toBe('ignorable');
    }
  });
});

describe('buscarEvento', () => {
  it('resuelve parámetros de ruta', () => {
    const r = buscarEvento('PATCH', '/api/tickets-pesaje/abc-123/completar');
    expect(r?.evento.clave).toBe('ticket.completado');
    expect(r?.params).toEqual({ id: 'abc-123' });
  });

  it('prefiere la ruta literal sobre la paramétrica', () => {
    expect(buscarEvento('PATCH', '/api/productos/reordenar')?.evento.clave).toBe('producto.reordenado');
    expect(buscarEvento('PATCH', '/api/productos/xyz')?.evento.clave).toBe('producto.editado');
  });

  it('distingue por método y devuelve null para lecturas o rutas desconocidas', () => {
    expect(buscarEvento('GET', '/api/tickets-pesaje')).toBeNull();
    expect(buscarEvento('POST', '/api/no-existe')).toBeNull();
    expect(buscarEvento('POST', '/api/tickets-pesaje')?.evento.clave).toBe('ticket.iniciado');
    expect(buscarEvento('DELETE', '/api/tickets-pesaje/9')?.evento.clave).toBe('ticket.eliminado');
  });

  it('tolera barra final', () => {
    expect(buscarEvento('POST', '/api/facturas-venta/')?.evento.clave).toBe('factura_venta.emitida');
  });
});

describe('debeNotificar', () => {
  const base = { silenciados: [] as string[], incluirRuidosos: false };
  const ev = (clave: string) => CATALOGO_EVENTOS.find(e => e.clave === clave)!;

  it('nunca avisa ignorables', () => {
    expect(debeNotificar(ev('auth.login'), { ...base, incluirRuidosos: true })).toBe(false);
  });
  it('los ruidosos solo con el interruptor', () => {
    expect(debeNotificar(ev('toma_fisica.pesaje'), base)).toBe(false);
    expect(debeNotificar(ev('toma_fisica.pesaje'), { ...base, incluirRuidosos: true })).toBe(true);
  });
  it('silencia por clave o por categoría', () => {
    expect(debeNotificar(ev('ticket.editado'), { ...base, silenciados: ['ticket.editado'] })).toBe(false);
    expect(debeNotificar(ev('ticket.editado'), { ...base, silenciados: ['pesaje'] })).toBe(false);
    expect(debeNotificar(ev('ticket.editado'), { ...base, silenciados: ['maestros'] })).toBe(true);
  });
});

describe('plantillas', () => {
  const ctxBase = (over: Partial<ContextoEvento>): ContextoEvento => ({
    metodo: 'POST', ruta: '/x', params: {}, reqBody: {}, resBody: {}, extra: {}, ...over,
  });

  it('ticket en bruto = "Se inició un pesaje"; completo desde el inicio cambia el texto', () => {
    const e = CATALOGO_EVENTOS.find(x => x.clave === 'ticket.iniciado')!;
    expect(resolverVariante(e, ctxBase({ resBody: { ticket: { estado: 'bruto' } } })).accion).toBe('Se inició un pesaje');
    expect(resolverVariante(e, ctxBase({ resBody: { ticket: { estado: 'completo' } } })).accion).toMatch(/terminó el pesaje/);
  });

  it('pago múltiple muestra código y monto', () => {
    const e = CATALOGO_EVENTOS.find(x => x.clave === 'pago.multiple')!;
    const ctx = ctxBase({ reqBody: { montoUsd: 150.5, items: [{}, {}] }, resBody: { numeroPago: 7, numeroAdelanto: 2, numeroCruce: null } });
    expect(e.etiqueta?.(ctx)).toBe('Pago PG-0007');
    const lineas = e.detalles!(ctx).join('\n');
    expect(lineas).toContain('150,5');
    expect(lineas).toContain('PG-0007');
    expect(lineas).toContain('AD-0002');
  });

  it('ticket completado lista materiales con kg', () => {
    const e = CATALOGO_EVENTOS.find(x => x.clave === 'ticket.completado')!;
    const lineas = e.detalles!(ctxBase({
      resBody: { ticket: { vehiculo: 'ABC123', pesoGlobal: 1000, pesoNetoTotal: 900, materiales: [{ nombreProducto: 'Cobre', pesoNeto: 900 }] } },
    }));
    expect(lineas).toEqual(expect.arrayContaining(['Vehículo: ABC123', '• Cobre: 900 kg']));
  });

  it('ticket completado dice el tipo y el día del ticket', () => {
    const e = CATALOGO_EVENTOS.find(x => x.clave === 'ticket.completado')!;
    const lineas = e.detalles!(ctxBase({ resBody: { ticket: { tipo: 'compra', fecha: '2026-09-25', vehiculo: 'ABC123' } } }));
    expect(lineas).toEqual(expect.arrayContaining(['Tipo: Compra', 'Fecha del ticket: 25/09/2026']));
  });
});

describe('NUNCA salen datos sensibles', () => {
  const SECRETOS = ['S3CR3T0-PASSWORD', 'tok-ABCDEF-0123456789', 'LLAVE-9999-XYZ', '$2a$10$abcdefghijklmnopqrstuv', 'hash-deadbeef'];
  const bodySucio = {
    password: SECRETOS[0], token: SECRETOS[1], llaveEdicion: SECRETOS[2], password_hash: SECRETOS[3], hash: SECRETOS[4],
    llave: SECRETOS[2], clave: SECRETOS[0],
  };

  it('ninguna plantilla de ninguna ruta imprime campos sensibles del request o la respuesta', () => {
    const ctx: ContextoEvento = {
      metodo: 'POST', ruta: '/x', params: { id: 'id1' },
      reqBody: { ...bodySucio, usuario: bodySucio, entidadTipo: 'ticket_pesaje', tipo: 'credito' },
      resBody: { ...bodySucio, usuario: bodySucio, ticket: { ...bodySucio, estado: 'bruto' }, factura: bodySucio, tomaFisica: bodySucio },
      extra: {},
    };
    for (const e of CATALOGO_EVENTOS) {
      const salida = [e.accion, ...(e.detalles?.(ctx) ?? []), e.etiqueta?.(ctx) ?? ''].join('\n');
      for (const s of SECRETOS) expect(salida, `${e.clave} filtró ${s}`).not.toContain(s);
    }
  });

  it('edición de usuario solo nombra campos; la contraseña nunca aparece', () => {
    const e = CATALOGO_EVENTOS.find(x => x.clave === 'usuario.editado')!;
    const salida = e.detalles!({
      metodo: 'PATCH', ruta: '/x', params: {}, resBody: {}, extra: {},
      reqBody: { password: SECRETOS[0], nombre: 'Ana', rol: 'administracion', permisos: [{ recurso: 'x', accion: 'y' }] },
    }).join('\n');
    expect(salida).toContain('contraseña restablecida');
    expect(salida).toContain('rol → administracion');
    expect(salida).not.toContain(SECRETOS[0]);
  });

  it('llave generada no incluye el código de la llave de la respuesta', () => {
    const e = CATALOGO_EVENTOS.find(x => x.clave === 'llave.generada')!;
    const salida = e.detalles!({
      metodo: 'POST', ruta: '/x', params: {}, extra: {},
      reqBody: { entidadTipo: 'ticket_pesaje', entidadId: 'u1' }, resBody: { codigo: SECRETOS[2], llave: SECRETOS[2] },
    }).join('\n');
    expect(salida).toContain('ticket de pesaje');
    expect(salida).not.toContain(SECRETOS[2]);
  });

  it('formatearCambios descarta campos sensibles y enmascara valores opacos', () => {
    const lineas = formatearCambios({
      'Peso neto': { antes: 10, despues: 12 },
      'Contraseña': { antes: 'a', despues: SECRETOS[0] },
      llaveEdicion: { antes: null, despues: SECRETOS[2] },
      Observación: { antes: null, despues: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.firmafirmafirma' },
    }).join('\n');
    expect(lineas).toContain('Peso neto: 10 → 12');
    expect(lineas).not.toContain(SECRETOS[0]);
    expect(lineas).not.toContain(SECRETOS[2]);
    expect(lineas).not.toContain('eyJhbGci');
    expect(lineas).toContain('[oculto]');
  });

  it('esClaveSensible y sanitizarValor', () => {
    for (const k of ['password', 'passwordHash', 'token', 'llaveEdicion', 'clave', 'api_key', 'Authorization']) {
      expect(esClaveSensible(k), k).toBe(true);
    }
    expect(esClaveSensible('Peso neto')).toBe(false);
    expect(sanitizarValor('$2a$10$abcdefghijklmnopqrstuv')).toBe('[oculto]');
    expect(sanitizarValor('x'.repeat(200)).length).toBeLessThanOrEqual(80);
    expect(sanitizarValor(null)).toBe('—');
  });
});

describe('formatearMensaje', () => {
  it('escapa HTML del usuario y muestra quién y cuándo', () => {
    const texto = formatearMensaje({
      icono: '🗑️', accion: 'Se ELIMINÓ un cliente', entidad: 'Cliente <b>X</b> & Co',
      actor: { nombre: 'Ana <script>', rol: 'administracion' },
      fecha: new Date('2026-10-03T18:05:00Z'), zona: 'America/Caracas',
    });
    expect(texto).toContain('&lt;b&gt;X&lt;/b&gt; &amp; Co');
    expect(texto).not.toContain('<script>');
    expect(texto).toContain('👤 Ana &lt;script&gt; (Administración)');
    expect(texto).toMatch(/🕒 03\/10\/2026 14:05/);
  });

  it('escaparHtml', () => {
    expect(escaparHtml('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });
});
