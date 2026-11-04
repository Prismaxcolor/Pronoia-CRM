/** Ejecuta `tareas` con a lo sumo `limite` en vuelo a la vez. Cada tarea falla por separado (nunca rechaza):
 *  devuelve el resultado de cada una en el orden recibido, como Promise.allSettled. */
export async function ejecutarConLimite<T>(
  tareas: ReadonlyArray<() => Promise<T>>,
  limite: number,
): Promise<PromiseSettledResult<T>[]> {
  const resultados: PromiseSettledResult<T>[] = new Array(tareas.length);
  let siguiente = 0;
  const trabajador = async (): Promise<void> => {
    while (siguiente < tareas.length) {
      const i = siguiente++;
      try {
        resultados[i] = { status: 'fulfilled', value: await tareas[i]() };
      } catch (reason) {
        resultados[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, tareas.length)) }, trabajador));
  return resultados;
}
