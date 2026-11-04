import { describe, it, expect } from 'vitest';
import { extraerGrupos } from '../src/utils/telegram-grupos.js';

describe('extraerGrupos', () => {
  it('detecta el grupo desde my_chat_member (cuando añaden al bot)', () => {
    const grupos = extraerGrupos([
      { update_id: 1, my_chat_member: { chat: { id: -1001234567890, type: 'supergroup', title: 'Pronoia Operaciones' }, new_chat_member: { status: 'administrator' } } },
    ]);
    expect(grupos).toEqual([{ chatId: -1001234567890, titulo: 'Pronoia Operaciones', tipo: 'supergroup', origen: 'my_chat_member' }]);
  });

  it('ignora chats privados y no repite grupos', () => {
    const grupos = extraerGrupos([
      { update_id: 1, message: { chat: { id: 555, type: 'private' }, text: 'hola' } },
      { update_id: 2, message: { chat: { id: -42, type: 'group', title: 'G' }, text: 'a' } },
      { update_id: 3, message: { chat: { id: -42, type: 'group', title: 'G' }, text: 'b' } },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].chatId).toBe(-42);
  });

  it('no copia mensajes ni datos de personas', () => {
    const [g] = extraerGrupos([{ update_id: 1, message: { from: { first_name: 'Ana' }, text: 'secreto', chat: { id: -9, type: 'group', title: 'G' } } }]);
    expect(JSON.stringify(g)).not.toMatch(/Ana|secreto/);
  });

  it('tolera entradas inválidas', () => {
    expect(extraerGrupos(null)).toEqual([]);
    expect(extraerGrupos([null, 3, { message: 'x' }, { message: { chat: { id: 'a' } } }])).toEqual([]);
  });
});
