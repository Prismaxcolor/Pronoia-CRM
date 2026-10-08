import { describe, it, expect } from 'vitest';
import {
  calcularExpiracion,
  edicionRequiereLlave,
  esSuperadminVigente,
  evaluarLlave,
  generarCodigoLlave,
  hashLlave,
  LLAVE_VIGENCIA_MINUTOS,
  mensajeLlaveInvalida,
  normalizarCodigoLlave,
  type LlaveRegistro,
} from '../src/utils/llave-edicion.js';
import { calcularCambios, RECURSO_POR_ENTIDAD, ENTIDADES_AUDITABLES, ENTIDADES_CON_LLAVE, TABLA_POR_ENTIDAD } from '../src/utils/auditoria.js';
import { resumirTicket, type TicketAuditable } from '../src/utils/auditoria-ticket.js';
import { crearLlaveSchema, paramsAuditoriaSchema } from '../src/schemas/auditoria.js';
import { editarTicketSchema } from '../src/schemas/tickets-pesaje.js';
import { PERMISOS_POR_ROL, tienePermiso } from '../src/utils/permisos.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const AHORA = new Date('2026-09-30T12:00:00Z');

function llave(parcial: Partial<LlaveRegistro> = {}): LlaveRegistro {
  return {
    entidadTipo: 'ticket_pesaje',
    entidadId: UUID,
    expiraEn: calcularExpiracion(AHORA),
    usadaEn: null,
    ...parcial,
  };
}
const destino = { entidadTipo: 'ticket_pesaje', entidadId: UUID };

describe('generación de llaves', () => {
  it('genera códigos con formato XXXXX-XXXXX sin caracteres ambiguos', () => {
    for (let i = 0; i < 50; i++) {
      expect(generarCodigoLlave()).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    }
  });

  it('dos códigos consecutivos son distintos', () => {
    expect(generarCodigoLlave()).not.toBe(generarCodigoLlave());
  });

  it('el hash es sha256 hex y no contiene el código', () => {
    const codigo = 'ABCDE-FGHJK';
    const h = hashLlave(codigo);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('ABCDE');
  });

  it('el hash ignora mayúsculas, guiones y espacios', () => {
    expect(hashLlave('abcde-fghjk')).toBe(hashLlave('ABCDE FGHJK'));
    expect(normalizarCodigoLlave(' ab-cd ')).toBe('ABCD');
  });

  it('códigos distintos producen hashes distintos', () => {
    expect(hashLlave('AAAAA-AAAAA')).not.toBe(hashLlave('AAAAA-AAAAB'));
  });
});

describe('expiración y uso único', () => {
  it('vence a los 15 minutos', () => {
    expect(LLAVE_VIGENCIA_MINUTOS).toBe(15);
    expect(calcularExpiracion(AHORA).getTime() - AHORA.getTime()).toBe(15 * 60_000);
  });

  it('una llave vigente y sin usar es válida', () => {
    expect(evaluarLlave(llave(), destino, AHORA)).toEqual({ valida: true });
  });

  it('expirada justo en el instante de vencimiento', () => {
    const l = llave({ expiraEn: AHORA });
    expect(evaluarLlave(l, destino, AHORA)).toEqual({ valida: false, motivo: 'expirada' });
  });

  it('expirada 16 minutos después', () => {
    const despues = new Date(AHORA.getTime() + 16 * 60_000);
    expect(evaluarLlave(llave(), destino, despues)).toEqual({ valida: false, motivo: 'expirada' });
  });

  it('una llave ya usada no sirve una segunda vez', () => {
    const usada = llave({ usadaEn: AHORA });
    expect(evaluarLlave(usada, destino, AHORA)).toEqual({ valida: false, motivo: 'usada' });
  });

  it('no sirve para otro documento (id distinto)', () => {
    expect(evaluarLlave(llave(), { ...destino, entidadId: UUID2 }, AHORA)).toEqual({
      valida: false,
      motivo: 'otra_entidad',
    });
  });

  it('no sirve para otro tipo de documento', () => {
    expect(evaluarLlave(llave(), { ...destino, entidadTipo: 'factura_venta' }, AHORA)).toEqual({
      valida: false,
      motivo: 'otra_entidad',
    });
  });

  it('una llave inexistente se rechaza', () => {
    expect(evaluarLlave(null, destino, AHORA)).toEqual({ valida: false, motivo: 'inexistente' });
  });

  it('cada motivo tiene mensaje en español', () => {
    for (const m of ['inexistente', 'otra_entidad', 'usada', 'expirada'] as const) {
      expect(mensajeLlaveInvalida(m).length).toBeGreaterThan(10);
    }
  });
});

describe('regla de permiso: edicionRequiereLlave', () => {
  it('la llave está activa por defecto: sin variable, todo rol salvo superadmin la necesita', () => {
    expect(edicionRequiereLlave('administracion', undefined)).toBe(true);
    expect(edicionRequiereLlave('trabajador', undefined)).toBe(true);
    expect(edicionRequiereLlave('administracion', '')).toBe(true);
    expect(edicionRequiereLlave('administracion', 'true')).toBe(true);
    expect(edicionRequiereLlave('superadmin', undefined)).toBe(false);
    expect(edicionRequiereLlave('superadmin', 'true')).toBe(false);
  });

  it('solo el valor exacto "false" la apaga (interruptor de emergencia)', () => {
    expect(edicionRequiereLlave('administracion', 'false')).toBe(false);
    expect(edicionRequiereLlave('trabajador', 'false')).toBe(false);
    expect(edicionRequiereLlave('administracion', 'FALSE')).toBe(true);
    expect(edicionRequiereLlave('administracion', '0')).toBe(true);
  });

  it('cada entidad auditable mapea a un recurso cuyo permiso ver tiene el superadmin', () => {
    for (const tipo of ENTIDADES_AUDITABLES) {
      expect(tienePermiso(PERMISOS_POR_ROL.superadmin, RECURSO_POR_ENTIDAD[tipo], 'ver')).toBe(true);
    }
  });
});

describe('schemas de auditoría y llaves', () => {
  it('crearLlaveSchema acepta tipo y uuid válidos', () => {
    expect(crearLlaveSchema.safeParse({ entidadTipo: 'ticket_pesaje', entidadId: UUID }).success).toBe(true);
  });

  it('crearLlaveSchema rechaza tipo desconocido o id no uuid', () => {
    expect(crearLlaveSchema.safeParse({ entidadTipo: 'usuarios', entidadId: UUID }).success).toBe(false);
    expect(crearLlaveSchema.safeParse({ entidadTipo: 'ticket_pesaje', entidadId: '123' }).success).toBe(false);
  });

  it('paramsAuditoriaSchema valida los params de la ruta GET', () => {
    expect(paramsAuditoriaSchema.safeParse({ entidadTipo: 'factura_compra', entidadId: UUID }).success).toBe(true);
    expect(paramsAuditoriaSchema.safeParse({ entidadTipo: 'x', entidadId: UUID }).success).toBe(false);
  });

  it('editarTicketSchema acepta llaveEdicion opcional y no la exige', () => {
    const base = {
      materiales: [
        { productoId: UUID, pesoBruto: 10, tara: 1, destino: 'mpp', fotos: ['https://x/y.jpg'] },
      ],
    };
    const sin = editarTicketSchema.safeParse(base);
    expect(sin.success).toBe(true);
    const con = editarTicketSchema.safeParse({ ...base, llaveEdicion: ' ABCDE-FGHJK ' });
    expect(con.success).toBe(true);
    if (con.success) expect(con.data.llaveEdicion).toBe('ABCDE-FGHJK');
  });
});

describe('calcularCambios / resumirTicket', () => {
  const ticket = (parcial: Partial<TicketAuditable> = {}): TicketAuditable => ({
    observaciones: null,
    vehiculo: 'Camión 1',
    devolucion: 0,
    pesoNetoTotal: 9,
    materiales: [
      { nombreProducto: 'Cobre', pesoBruto: 10, tara: 1, pesoNeto: 9, destinoTipo: 'mpp', nombreLote: null },
    ],
    ...parcial,
  });

  it('sin diferencias devuelve objeto vacío', () => {
    expect(calcularCambios(resumirTicket(ticket()), resumirTicket(ticket()))).toEqual({});
  });

  it('reporta solo los campos que cambiaron con antes y después', () => {
    const despues = ticket({
      vehiculo: 'Camión 2',
      pesoNetoTotal: 8,
      materiales: [
        { nombreProducto: 'Cobre', pesoBruto: 10, tara: 2, pesoNeto: 8, destinoTipo: 'mpp', nombreLote: null },
      ],
    });
    const cambios = calcularCambios(resumirTicket(ticket()), resumirTicket(despues));
    expect(Object.keys(cambios).sort()).toEqual(['Material: Cobre · Peso neto (kg)', 'Material: Cobre · Tara (kg)', 'Peso neto total (kg)', 'Vehículo']);
    expect(cambios['Vehículo']).toEqual({ antes: 'Camión 1', despues: 'Camión 2' });
  });

  it('un material agregado o quitado aparece con null en el otro lado', () => {
    const extra = ticket({
      materiales: [
        ...ticket().materiales,
        { nombreProducto: 'Bronce', pesoBruto: 5, tara: 0, pesoNeto: 5, destinoTipo: 'mpp', nombreLote: null },
      ],
    });
    const cambios = calcularCambios(resumirTicket(ticket()), resumirTicket(extra));
    expect(cambios['Material: Bronce · Peso neto (kg)'].antes).toBeNull();
    expect(cambios['Material: Bronce · Peso neto (kg)'].despues).toBe(5);
  });

  it('no muta las instantáneas de entrada', () => {
    const a = resumirTicket(ticket());
    const copia = { ...a };
    calcularCambios(a, resumirTicket(ticket({ vehiculo: 'otro' })));
    expect(a).toEqual(copia);
  });
});

describe("esSuperadminVigente (rol releído de la BD)", () => {
  it("solo un superadmin activo puede entregar llaves", () => {
    expect(esSuperadminVigente({ rol: "superadmin", activo: true })).toBe(true);
  });

  it("un superadmin inactivo no puede", () => {
    expect(esSuperadminVigente({ rol: "superadmin", activo: false })).toBe(false);
  });

  it("un usuario degradado (JWT viejo con superadmin) no puede", () => {
    expect(esSuperadminVigente({ rol: "administracion", activo: true })).toBe(false);
  });

  it("un usuario inexistente no puede", () => {
    expect(esSuperadminVigente(null)).toBe(false);
  });
});

describe("entidades con llave", () => {
  it("hoy aceptan llave tickets, transformaciones, traslados, pagos, cobros, movimientos de banca y anulación de notas", () => {
    expect([...ENTIDADES_CON_LLAVE]).toEqual([
      "ticket_pesaje", "transformacion", "traslado",
      "pago", "cobro", "movimiento_banca", "nota_ajuste_proveedor", "nota_ajuste_cliente",
    ]);
  });

  it("pagos y cobros comparten la vista pagos_grupo (existencia del grupo) y los movimientos su tabla", () => {
    expect(TABLA_POR_ENTIDAD.pago).toBe("pagos_grupo");
    expect(TABLA_POR_ENTIDAD.cobro).toBe("pagos_grupo");
    expect(TABLA_POR_ENTIDAD.movimiento_banca).toBe("movimientos");
    expect(TABLA_POR_ENTIDAD.nota_ajuste_proveedor).toBe("notas_ajuste_proveedor");
    expect(TABLA_POR_ENTIDAD.nota_ajuste_cliente).toBe("notas_ajuste_cliente");
  });

  it("crearLlaveSchema acepta transformación y rechaza facturas (no tienen edición)", () => {
    expect(crearLlaveSchema.safeParse({ entidadTipo: "transformacion", entidadId: UUID }).success).toBe(true);
    for (const tipo of ["factura_compra", "factura_venta"]) {
      expect(crearLlaveSchema.safeParse({ entidadTipo: tipo, entidadId: UUID }).success).toBe(false);
    }
  });

  it("toda entidad con llave es auditable y tiene tabla para verificar existencia", () => {
    for (const tipo of ENTIDADES_CON_LLAVE) {
      expect(ENTIDADES_AUDITABLES).toContain(tipo);
      expect(TABLA_POR_ENTIDAD[tipo]).toBeTruthy();
    }
  });

  it("factura y transformación siguen siendo auditables (historial de solo lectura)", () => {
    expect(paramsAuditoriaSchema.safeParse({ entidadTipo: "transformacion", entidadId: UUID }).success).toBe(true);
  });
});
