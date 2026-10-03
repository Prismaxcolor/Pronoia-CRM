import { describe, it, expect } from 'vitest';
import { detallesDeCambios, lineasDeCambios, normalizarCampo, columnasDiff, esTablaDiff } from '../src/services/grupo-diff.js';

const proveedor = {
  nombre: 'Chatarra SA', rfc: 'J-12345678-9', telefono: '0414-1111111', email: 'a@x.test', activo: true,
  fotos: ['https://img.test/a.jpg', 'https://img.test/b.jpg'],
};

describe('diff de ediciones de maestros', () => {
  it('solo cambia la cédula: solo "documento (cédula/RIF) modificado", sin el valor', () => {
    const salida = detallesDeCambios('proveedores', proveedor, { ...proveedor, rfc: 'V-99999999' });
    expect(salida).toEqual(['Cambió:', '• documento (cédula/RIF) modificado']);
    const texto = salida.join('\n');
    expect(texto).not.toContain('J-12345678-9');
    expect(texto).not.toContain('V-99999999');
    expect(texto).not.toMatch(/teléfono|correo|fotos|nombre/);
  });

  it('todo igual: sin cambios (arreglo vacío)', () => {
    expect(detallesDeCambios('proveedores', proveedor, { ...proveedor })).toEqual([]);
  });

  it('fotos con el mismo contenido en distinto orden no cuentan como cambio', () => {
    const despues = { ...proveedor, fotos: [...proveedor.fotos].reverse() };
    expect(lineasDeCambios('proveedores', proveedor, despues)).toEqual([]);
  });

  it('fotos distintas: solo el nombre del campo, jamás las URLs', () => {
    const salida = lineasDeCambios('proveedores', proveedor, { ...proveedor, fotos: ['https://img.test/c.jpg'] }).join('\n');
    expect(salida).toBe('• fotos modificado');
    expect(salida).not.toContain('img.test');
  });

  it('null, "" y espacios son lo mismo', () => {
    const antes = { ...proveedor, telefono: null, email: '' };
    const despues = { ...proveedor, telefono: '   ', email: null };
    expect(lineasDeCambios('proveedores', antes, despues)).toEqual([]);
  });

  it('teléfono pasa de vacío a un valor: dice "teléfono modificado" sin el número', () => {
    const salida = lineasDeCambios('proveedores', { ...proveedor, telefono: null }, { ...proveedor, telefono: '0412-5555555' });
    expect(salida).toEqual(['• teléfono modificado']);
  });

  it('nombre y activo muestran antes → después; booleanos legibles', () => {
    const salida = lineasDeCambios('proveedores', proveedor, { ...proveedor, nombre: 'Nuevo SA', activo: false });
    expect(salida).toEqual(['• nombre: Chatarra SA → Nuevo SA', '• activo: sí → no']);
  });

  it('valores mostrados se recortan a ~40 caracteres', () => {
    const largo = 'N'.repeat(100);
    const [linea] = lineasDeCambios('proveedores', proveedor, { ...proveedor, nombre: largo });
    expect(linea.length).toBeLessThan(80);
    expect(linea).toContain('…');
  });

  it('números como string (10 vs "10.00") no son cambio; en productos el costo nunca se muestra', () => {
    expect(lineasDeCambios('taras', { nombre: 'T', peso: 10, activo: true, fotos: [] }, { nombre: 'T', peso: '10.00', activo: true, fotos: null })).toEqual([]);
    const l = lineasDeCambios('productos', { costo_unitario: 5 }, { costo_unitario: 7 });
    expect(l).toEqual(['• costo modificado']);
  });

  it('clientes: dirección, notas e identificación solo por nombre de campo', () => {
    const salida = lineasDeCambios(
      'clientes',
      { nombre: 'C', identificacion: 'V-1', direccion: 'Calle 1', notas: 'secreto', activo: true },
      { nombre: 'C', identificacion: 'V-2', direccion: 'Calle 2', notas: 'otro', activo: true },
    );
    expect(salida).toEqual(['• documento (cédula/RIF) modificado', '• dirección modificado', '• notas modificado']);
  });

  it('usuarios: nombre de campo; permisos por contenido sin importar el orden; contraseña solo como aviso', () => {
    const p1 = [{ recurso: 'a', accion: 'x' }, { recurso: 'b', accion: 'y' }];
    const base = { nombre: 'Ana', email: 'a@x.test', rol: 'trabajador', permisos: p1, activo: true };
    expect(lineasDeCambios('users', base, { ...base, permisos: [...p1].reverse() })).toEqual([]);
    const salida = detallesDeCambios('users', base, { ...base, email: 'nuevo@x.test', nombre: 'Ana B' }, ['• contraseña restablecida']).join('\n');
    expect(salida).toContain('• correo modificado');
    expect(salida).toContain('• nombre modificado');
    expect(salida).toContain('contraseña restablecida');
    expect(salida).not.toContain('nuevo@x.test');
  });

  it('las columnas de users nunca incluyen password_hash', () => {
    expect(columnasDiff('users')).not.toMatch(/pass|hash|token/i);
  });

  it('esTablaDiff y normalizarCampo', () => {
    expect(esTablaDiff('proveedores')).toBe(true);
    expect(esTablaDiff('bancas')).toBe(false);
    expect(esTablaDiff(undefined)).toBe(false);
    expect(normalizarCampo('  a   b ', 'texto')).toBe('a b');
    expect(normalizarCampo(null, 'bool')).toBe('false');
    expect(normalizarCampo([], 'lista')).toBeNull();
  });
});
