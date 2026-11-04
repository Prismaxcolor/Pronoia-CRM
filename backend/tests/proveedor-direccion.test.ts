import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bd = vi.hoisted(() => ({
  insertado: null as Record<string, unknown> | null,
  actualizado: null as Record<string, unknown> | null,
  filaDevuelta: { id: 'p1', nombre: 'Alfa', rfc: null, telefono: null, email: null, activo: true, created_at: '2026-10-24T00:00:00Z', fotos: [], telegram_chat_id: null, telegram_linked_at: null } as Record<string, unknown>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (fila: Record<string, unknown>) => {
        bd.insertado = fila;
        return { select: () => ({ single: () => Promise.resolve({ data: { ...bd.filaDevuelta, ...fila }, error: null }) }) };
      },
      update: (valores: Record<string, unknown>) => {
        bd.actualizado = valores;
        return { eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { ...bd.filaDevuelta, ...valores }, error: null }) }) }) };
      },
      select: () => ({ order: () => Promise.resolve({ data: [bd.filaDevuelta], error: null }) }),
    }),
  },
}));

import { crearProveedorSchema, actualizarProveedorSchema } from '../src/schemas/proveedores.js';
import { actualizarProveedor, crearProveedor, listarProveedores } from '../src/services/proveedor-service.js';

describe('proveedores: dirección (schema)', () => {
  it('acepta una dirección y la recorta', () => {
    const r = crearProveedorSchema.safeParse({ nombre: 'Alfa', direccion: '  Av. Principal, Galpón 3  ' });
    expect(r.success && r.data.direccion).toBe('Av. Principal, Galpón 3');
  });

  it('una dirección vacía o ausente queda en null en el alta', () => {
    const vacia = crearProveedorSchema.safeParse({ nombre: 'Alfa', direccion: '   ' });
    expect(vacia.success && vacia.data.direccion).toBeNull();
    const ausente = crearProveedorSchema.safeParse({ nombre: 'Alfa' });
    expect(ausente.success && ausente.data.direccion).toBeNull();
  });

  it('al editar, no mandar la dirección no la borra (la clave queda ausente)', () => {
    const r = actualizarProveedorSchema.safeParse({ telefono: '0412' });
    expect(r.success && 'direccion' in r.data).toBe(false);
  });

  it('rechaza más de 300 caracteres (igual que la restricción de la base)', () => {
    expect(crearProveedorSchema.safeParse({ nombre: 'Alfa', direccion: 'x'.repeat(301) }).success).toBe(false);
    expect(crearProveedorSchema.safeParse({ nombre: 'Alfa', direccion: 'x'.repeat(300) }).success).toBe(true);
  });

  it('se puede actualizar solo la dirección', () => {
    const r = actualizarProveedorSchema.safeParse({ direccion: 'Nueva dirección' });
    expect(r.success).toBe(true);
  });
});

describe('proveedores: dirección (servicio)', () => {
  beforeEach(() => { bd.insertado = null; bd.actualizado = null; });

  it('el alta con dirección la guarda y la devuelve', async () => {
    const r = await crearProveedor({ nombre: 'Alfa', rfc: null, telefono: null, email: null, direccion: 'Av. Principal' });
    expect(bd.insertado).toMatchObject({ nombre: 'Alfa', direccion: 'Av. Principal' });
    expect(r).toMatchObject({ proveedor: { nombre: 'Alfa', direccion: 'Av. Principal' } });
  });

  it('el alta sin dirección no envía la columna (no depende de la migración)', async () => {
    await crearProveedor({ nombre: 'Alfa', rfc: null, telefono: null, email: null, direccion: null });
    expect(bd.insertado).not.toHaveProperty('direccion');
    await crearProveedor({ nombre: 'Alfa', rfc: null, telefono: null, email: null });
    expect(bd.insertado).not.toHaveProperty('direccion');
  });

  it('editar la dirección la envía; borrarla manda null', async () => {
    await actualizarProveedor('p1', { direccion: 'Calle 5' });
    expect(bd.actualizado).toEqual({ direccion: 'Calle 5' });
    await actualizarProveedor('p1', { direccion: null });
    expect(bd.actualizado).toEqual({ direccion: null });
  });

  it('editar otros campos no toca la dirección', async () => {
    await actualizarProveedor('p1', { telefono: '0412' });
    expect(bd.actualizado).toEqual({ telefono: '0412' });
  });

  it('la lista devuelve direccion null cuando la columna aún no existe', async () => {
    const lista = await listarProveedores();
    expect(lista[0].direccion).toBeNull();
  });

  it('la lista devuelve la dirección guardada', async () => {
    bd.filaDevuelta = { ...bd.filaDevuelta, direccion: 'Zona industrial' };
    const lista = await listarProveedores();
    expect(lista[0].direccion).toBe('Zona industrial');
    bd.filaDevuelta = { ...bd.filaDevuelta, direccion: undefined };
  });
});

describe('migration_proveedores_direccion.sql', () => {
  const leer = (a: string): string => readFileSync(resolve(__dirname, '../../docs', a), 'utf-8');
  const sql = leer('migration_proveedores_direccion.sql');

  it('agrega la columna de forma idempotente y acotada a 300 caracteres', () => {
    expect(sql).toMatch(/add column if not exists direccion text/);
    expect(sql).toMatch(/char_length\(direccion\) <= 300/);
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
  });

  it('tiene rollback', () => {
    const rb = leer('migration_proveedores_direccion_ROLLBACK.sql');
    expect(rb).toMatch(/drop column if exists direccion/);
  });
});
