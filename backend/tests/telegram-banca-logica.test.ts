import { describe, it, expect } from 'vitest';
import {
  esChatIdTelegramValido,
  gruposTelegramConocidos,
  normalizarChatIdTelegram,
} from '../../frontend/src/features/cochinito/telegram-banca';

const banca = (id: string, nombre: string, telegramChatId: string | null) => ({
  id, nombre, telegramChatId, tipo: 'efectivo' as const, saldo: 0, moneda: 'USD', descripcion: '', archivada: false,
});

describe('esChatIdTelegramValido', () => {
  it('acepta ids numéricos de grupo (negativos) y de usuario', () => {
    expect(esChatIdTelegramValido('-1001234567890')).toBe(true);
    expect(esChatIdTelegramValido('123456789')).toBe(true);
  });
  it('rechaza texto, @canales y ids demasiado cortos', () => {
    expect(esChatIdTelegramValido('@canal')).toBe(false);
    expect(esChatIdTelegramValido('mi grupo')).toBe(false);
    expect(esChatIdTelegramValido('-12')).toBe(false);
    expect(esChatIdTelegramValido('')).toBe(false);
  });
});

describe('normalizarChatIdTelegram', () => {
  it('recorta espacios y vacío => null', () => {
    expect(normalizarChatIdTelegram(' -1001234567890 ')).toBe('-1001234567890');
    expect(normalizarChatIdTelegram('   ')).toBeNull();
  });
});

describe('gruposTelegramConocidos', () => {
  it('agrupa por chat id con las bancas que lo usan, sin repetir ni incluir las que no tienen', () => {
    const r = gruposTelegramConocidos([
      banca('1', 'Banesco', '-1001111111'),
      banca('2', 'BNC', '-1001111111'),
      banca('3', 'Caja', null),
      banca('4', 'Binance', '-1002222222'),
    ]);
    expect(r).toEqual([
      { chatId: '-1001111111', bancas: ['Banesco', 'BNC'] },
      { chatId: '-1002222222', bancas: ['Binance'] },
    ]);
  });
  it('lista vacía => sin grupos', () => {
    expect(gruposTelegramConocidos([])).toEqual([]);
  });
});
