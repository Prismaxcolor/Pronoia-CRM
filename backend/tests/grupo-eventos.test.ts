import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CATALOGO_EVENTOS, buscarEvento, debeNotificar, destinoEvento, resolverVariante, type ContextoEvento,
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
    const criticos = ['ticket.editado', 'llave.generada', 'toma_fisica.culminada', 'toma_fisica.cancelada', 'pago.multiple', 'cobro.multiple', 'usuario.editado', 'nota.anulada_proveedor'];
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
  it('nunca avisa al grupo de operaciones eventos de dinero (facturas incluidas), ni con todos los interruptores', () => {
    const dinero = CATALOGO_EVENTOS.filter(e => ['tesoreria', 'facturacion', 'precios'].includes(e.categoria));
    expect(dinero.length).toBeGreaterThan(10);
    for (const e of [...dinero, ev('inventario.costos_referencia_editados'), ev('transformacion.valoracion')]) {
      expect(debeNotificar(e, { ...base, incluirRuidosos: true }), e.clave).toBe(false);
    }
    expect(debeNotificar(ev('vehiculo.creado'), base)).toBe(true);
  });
  it('la factura emitida NO va al grupo de operaciones (va a cajas)', () => {
    expect(debeNotificar(ev('factura_compra.emitida'), base)).toBe(false);
    expect(debeNotificar(ev('factura_venta.emitida'), base)).toBe(false);
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

  it('pesaje global por recepcionar = "Se guardó un pesaje global"; completo desde el inicio cambia el texto', () => {
    const e = CATALOGO_EVENTOS.find(x => x.clave === 'ticket.iniciado')!;
    expect(resolverVariante(e, ctxBase({ resBody: { ticket: { estado: 'bruto' } } })).accion).toBe('Se guardó un pesaje global (por recepcionar)');
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

describe('destinoEvento (ruteo operaciones / cajas)', () => {
  const base = { silenciados: [] as string[], incluirRuidosos: false };
  const ev = (clave: string) => CATALOGO_EVENTOS.find(e => e.clave === clave)!;

  it('pagos, cobros, cruces, bancas, notas y estados de cuenta van SOLO a cajas', () => {
    const claves = [
      'pago.registrado', 'pago.multiple', 'cobro.multiple', 'banca.movimiento', 'banca.creada', 'banca.archivada',
      'proveedor.nota_creada', 'nota.anulada_proveedor', 'cliente.nota_creada', 'cliente.estado_cuenta_enviado',
    ];
    for (const clave of claves) {
      expect(destinoEvento(ev(clave), base), clave).toBe('cajas');
      expect(debeNotificar(ev(clave), base), clave).toBe(false);
    }
  });
  it('la factura emitida va a cajas; los eventos operativos a operaciones', () => {
    expect(destinoEvento(ev('factura_compra.emitida'), base)).toBe('cajas');
    expect(destinoEvento(ev('factura_venta.emitida'), base)).toBe('cajas');
    expect(destinoEvento(ev('factura_venta.emitida'), { ...base, silenciados: ['facturacion'] })).toBeNull();
    expect(destinoEvento(ev('vehiculo.creado'), base)).toBe('operaciones');
    expect(destinoEvento(ev('ticket.editado'), base)).toBe('operaciones');
  });
  it('precios, costos y valoración no van a ningún grupo', () => {
    for (const clave of ['lista_precios.editada', 'lista_precios.eliminada', 'inventario.costos_referencia_editados', 'transformacion.valoracion']) {
      expect(destinoEvento(ev(clave), base), clave).toBeNull();
    }
  });
  it('ignorables, ruidosos y silenciados respetan los filtros también en cajas', () => {
    expect(destinoEvento(ev('auth.login'), base)).toBeNull();
    expect(destinoEvento(ev('pago.multiple'), { ...base, silenciados: ['pago.multiple'] })).toBeNull();
    expect(destinoEvento(ev('banca.movimiento'), { ...base, silenciados: ['tesoreria'] })).toBeNull();
  });
});

describe('transformaciones: el aviso dice EXACTAMENTE qué material se transforma', () => {
  const evento = (clave: string) => CATALOGO_EVENTOS.find(e => e.clave === clave)!;
  const ferroso = {
    id: 't1', codigo: 'TR-0007', categoria: 'ferroso_no_ferroso', estado: 'completa', nombreProductoEntrada: 'Chatarra mixta',
    almacenId: 'a1', nombreLoteOrigen: null, pesoNeto: 1000, entradaDetalle: [],
    salidas: [
      { nombreProducto: 'Hierro', nombreLoteDestino: null, nombreAlmacen: 'Patio 1', pesoNeto: 700, precioUnitario: 0.35 },
      { nombreProducto: 'Aluminio', nombreLoteDestino: null, nombreAlmacen: 'Patio 1', pesoNeto: 250, precioUnitario: 1.2 },
    ],
    costoUnitario: 0.2, facturaCompraId: 'f9',
  };
  const ctx = (metodo: ContextoEvento['metodo'], ruta: string, transformacion: unknown, extra: ContextoEvento['extra'] = {}): ContextoEvento =>
    ({ metodo, ruta, params: { id: 't1' }, reqBody: {}, resBody: { transformacion }, extra });
  const texto = (clave: string, c: ContextoEvento) => evento(clave).detalles!(c).join('\n');

  it('inicio ferroso/no ferroso: tipo, material, almacén y kilos de entrada (sin salidas aún)', () => {
    const t = { ...ferroso, estado: 'bruto', salidas: [] };
    const out = texto('transformacion.ferroso_creada', ctx('POST', '/api/transformaciones/ferroso', t, { almacenEntrada: 'Patio 1' }));
    expect(out).toContain('Tipo: Ferroso / No ferroso');
    expect(out).toContain('Material de entrada: Chatarra mixta');
    expect(out).toContain('Almacén: Patio 1');
    expect(out).toContain('Kilos de entrada: 1.000 kg');
    expect(out).not.toContain('Salidas obtenidas');
  });

  it('completar ferroso: salidas por material con kilos netos, total y merma, sin precios', () => {
    const out = texto('transformacion.ferroso_completada', ctx('PATCH', '/api/transformaciones/t1/completar-ferroso', ferroso, { almacenEntrada: 'Patio 1' }));
    expect(out).toContain('Salidas obtenidas:');
    expect(out).toContain('• Hierro (almacén Patio 1): 700 kg');
    expect(out).toContain('• Aluminio (almacén Patio 1): 250 kg');
    expect(out).toContain('Total salidas: 950 kg');
    expect(out).toContain('Merma: 50 kg');
    expect(out).not.toMatch(/\$|0[.,]35|1[.,]2|precio|costo/i);
  });

  it('PCB: inicio con lote de origen y completar con lote de destino', () => {
    const pcb = {
      categoria: 'pcb', estado: 'bruto', nombreProductoEntrada: null, nombreLoteOrigen: 'Lote Tarjetas 12', pesoNeto: 80, salidas: [],
    };
    const ini = texto('transformacion.pcb_creada', ctx('POST', '/api/transformaciones/pcb', pcb));
    expect(ini).toContain('Tipo: PCB');
    expect(ini).toContain('Lote de origen: Lote Tarjetas 12');
    expect(ini).toContain('Kilos de entrada: 80 kg');
    const fin = texto('transformacion.pcb_completada', ctx('PATCH', '/api/transformaciones/t1/completar-pcb', {
      ...pcb, estado: 'completa',
      salidas: [{ nombreProducto: null, nombreLoteDestino: 'Lote Placas Limpias', nombreAlmacen: 'Bodega', pesoNeto: 75 }],
    }));
    expect(fin).toContain('• Lote Lote Placas Limpias (almacén Bodega): 75 kg');
    expect(fin).toContain('Merma: 5 kg');
  });

  it('mixta: marca salida mixta y muestra material → lote', () => {
    const out = texto('transformacion.mixta_completada', ctx('PATCH', '/api/transformaciones/t1/completar-mixta', {
      ...ferroso, categoria: 'pcb', pesoNeto: 100,
      salidas: [
        { nombreProducto: 'Oro', nombreLoteDestino: null, nombreAlmacen: 'Caja fuerte', pesoNeto: 2 },
        { nombreProducto: 'Placa', nombreLoteDestino: 'Lote P', nombreAlmacen: null, pesoNeto: 90 },
      ],
    }));
    expect(out).toContain('Salida mixta (material y lote)');
    expect(out).toContain('• Oro (almacén Caja fuerte): 2 kg');
    expect(out).toContain('• Placa → Lote Lote P: 90 kg');
  });

  it('legacy (lote-pool) inicio y completar', () => {
    const t = { categoria: 'ferroso_no_ferroso', nombreLoteOrigen: 'Lote 5', pesoNeto: 300, salidas: [{ nombreLoteDestino: 'Lote 6', pesoNeto: 290 }] };
    expect(texto('transformacion.creada', ctx('POST', '/api/transformaciones', { ...t, salidas: [] }))).toContain('Lote de origen: Lote 5');
    expect(texto('transformacion.completada', ctx('PATCH', '/api/transformaciones/t1/completar', t))).toContain('• Lote Lote 6: 290 kg');
  });

  it('editada y merma: primero los cambios, luego el material actual', () => {
    const extra = { cambios: { 'Peso neto': { antes: 1000, despues: 1100 } }, autorizadoPor: 'Luis', almacenEntrada: 'Patio 1' };
    for (const [clave, ruta] of [['transformacion.editada', '/editar'], ['transformacion.merma_editada', '/merma']] as const) {
      const out = texto(clave, ctx('PATCH', `/api/transformaciones/t1${ruta}`, ferroso, extra));
      expect(out.indexOf('Cambios:'), clave).toBeLessThan(out.indexOf('Material de entrada'));
      expect(out, clave).toContain('Con llave de edición de Luis');
      expect(out, clave).toContain('• Hierro (almacén Patio 1): 700 kg');
    }
  });

  it('eliminada: usa la transformación leída antes de borrar', () => {
    const out = texto('transformacion.eliminada', { metodo: 'DELETE', ruta: '/api/transformaciones/t1', params: { id: 't1' }, reqBody: {}, resBody: { ok: true }, extra: { transformacion: ferroso, almacenEntrada: 'Patio 1' } });
    expect(out).toContain('Material de entrada: Chatarra mixta');
    expect(out).toContain('Total salidas: 950 kg');
  });

  it('sin datos de la transformación degrada a vacío (mensaje anterior), sin lanzar', () => {
    for (const clave of ['transformacion.creada', 'transformacion.eliminada', 'transformacion.pcb_completada']) {
      expect(evento(clave).detalles!({ metodo: 'POST', ruta: '/x', params: {}, reqBody: {}, resBody: {}, extra: {} })).toEqual([]);
    }
  });
});
