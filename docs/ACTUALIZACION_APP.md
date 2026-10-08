# Actualización de la app instalada (PWA)

## Qué hace el sistema

Cada compilación publica `/version.json` (`version`, `compiladoEn`, y opcionalmente `minima` y `notas`). La app que corre lleva dentro su propia versión (`__APP_VERSION__`) y la compara con la publicada:

- al abrir la app, cada 10 minutos, al volver a primer plano y al recuperar la conexión;
- sin depender del service worker (que en una PWA instalada casi nunca se revisa);
- sin red no hace nada ni molesta.

Si difiere, aparece una hoja inferior (móvil) o tarjeta flotante (escritorio) con "Actualizar ahora" y "Más tarde" (aplaza 1 hora). Si la versión que corre es anterior a `minima`, aparece un banner fijo arriba, no descartable, "Actualización requerida · Actualizar ahora"; NO bloquea nada: el usuario sigue trabajando debajo.

## Seguridad: nunca se pierde lo que el usuario hace

- La app NUNCA se recarga sola salvo en un momento seguro (`esMomentoSeguro`): sin operación de cola enviándose, sin subida de fotos, sin petición que escribe en vuelo, sin formulario/modal con cambios sin enviar, sin selector de cámara/archivos abierto, y sin que el usuario haya tocado o escrito en los últimos 60 s (en segundo plano basta con lo demás). Si no es seguro, espera y el aviso sigue visible.
- Al tocar "Actualizar ahora": primero espera a que termine cualquier envío o subida ("Esperando a que termine el envío…"); luego guarda YA todos los borradores y sus fotos en el navegador y espera la confirmación (`guardarTodosLosBorradoresAhora`). Si algo no se guarda (cuota llena, foto no guardada) NO recarga y avisa "No pudimos guardar tu trabajo; termina y guárdalo antes de actualizar". Si todo se guardó: "Tu trabajo quedó guardado como borrador; te devolveremos aquí", recarga en la misma ruta y el borrador se restaura con el aviso "Recuperamos tu borrador".

El menú del usuario muestra la versión instalada (`v 07/10/2026 · 03b28c4`) y el botón "Buscar actualización".

## Qué pasa al actualizar (escalera)

1. Si hay un service worker en espera: se activa y se recarga.
2. Si no, se busca uno nuevo hasta 8 s; si aparece, igual que el punto 1.
3. Si el service worker está atascado: restablecimiento suave (desregistrar service workers, borrar solo Cache Storage) y recarga con `?_act=<hora>` (se limpia solo de la URL).

Nunca se tocan IndexedDB, localStorage ni sessionStorage de datos: la cola de pesajes, los borradores, la sesión local y el PIN sobreviven. Hay una prueba automática que lo vigila (`backend/tests/actualizacion-app.test.ts` y `actualizacion-segura.test.ts`).

Anti-bucle: máximo 2 intentos automáticos por sesión; si fallan, se muestra un mensaje y el usuario puede reintentar a mano.

## Teléfonos que ya tienen la versión vieja

Los teléfonos instalados ANTES de este sistema no tienen la detección nueva: su app vieja depende del service worker, que puede no revisarse en días. Por eso necesitan recibir esta mejora UNA vez por el mecanismo antiguo. Es la única vez que hace falta algo manual. Pasos de rescate, en este orden:

1. Cerrar la app desde "recientes" (deslizarla fuera) y abrirla dos veces seguidas. Esto suele bastar: la primera apertura descarga la versión nueva y la segunda la usa.
2. Si sigue igual: Ajustes de Android > Apps > Pronoia > Almacenamiento > **Borrar caché**. Esto NO cierra la sesión ni borra datos (no usar "Borrar datos/almacenamiento").
3. Último recurso (como se hacía hasta ahora): desinstalar e instalar de nuevo. Antes, si hay pesajes pendientes en la cola, enviarlos o exportar el respaldo.

Cómo saber si un teléfono ya tiene el sistema nuevo: en el menú del usuario aparece "Buscar actualización" con la versión.

## Publicar una actualización obligatoria

Editar `frontend/novedades.json` antes del deploy:

```json
{
  "minima": "2026-10-08",
  "notas": ["Pesaje más rápido", "Corrección en inventario"]
}
```

- `minima`: fecha (`AAAA-MM-DD` o ISO). Toda app compilada ANTES de esa fecha se actualiza obligatoriamente. Dejar `""` para que la actualización sea opcional. Un valor que no sea fecha se ignora.
- `notas`: hasta 3 líneas visibles en el aviso y en "Pronoia se actualizó ✓". Dejar `[]` si no hay.
- Después de una obligatoria conviene volver a dejar `minima` en `""` en el siguiente deploy (no es necesario: las apps nuevas ya son posteriores a la fecha).

## Volver atrás

Quitar `plugVersionJson()` y `define` de `frontend/vite.config.ts`, la regla `/version.json` de `vercel.json`, `iniciarVersionRemota()` de `main.tsx`, `BuscarActualizacionPerfil` del Sidebar y restaurar `AvisoNuevaVersion.tsx` anterior (el aviso basado solo en `pwa-update.ts` sigue funcionando).
