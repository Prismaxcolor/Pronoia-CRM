import { useState } from 'react';

/** Recuerda en sessionStorage la pestaña/vista activa de una página entre
 *  visitas dentro de la misma pestaña del navegador — sin esto, ese estado
 *  vive solo en memoria (useState) y se pierde cada vez que el componente se
 *  desmonta: navegar a otra sección, entrar al detalle de un registro, o
 *  recargar la página. Siempre volvía a la pestaña por defecto. */
export function usePestanaRecordada<T extends string>(
  storageKey: string,
  valores: readonly T[],
  porDefecto: T,
): [T, (valor: T) => void] {
  const [valor, setValorState] = useState<T>(() => {
    try {
      const guardado = sessionStorage.getItem(storageKey);
      return guardado && (valores as readonly string[]).includes(guardado) ? (guardado as T) : porDefecto;
    } catch {
      return porDefecto;
    }
  });

  const setValor = (v: T) => {
    setValorState(v);
    try {
      sessionStorage.setItem(storageKey, v);
    } catch {
      // sessionStorage puede fallar (modo privado, cuota) — no crítico, solo se pierde la memoria de pestaña.
    }
  };

  return [valor, setValor];
}
