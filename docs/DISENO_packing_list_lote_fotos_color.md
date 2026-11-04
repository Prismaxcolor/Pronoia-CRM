# Packing list: lote seleccionable, color por lote y fotos por paleta

Fecha: 2026-10-11. Estado: implementado, migración sin aplicar (`migration_packing_list_lote_fotos.sql`).

## Pedidos del cliente

1. Poder agregar una o más fotos por paleta al cargar los pesos. Es de control interno, no se imprime.
2. El lote no se escribe a mano: se elige entre los lotes de exportación, viendo los kg disponibles y el almacén. Es información de control interno.
3. El color del lote se configura en Inventario (donde se editan los lotes) y queda como predeterminado en el packing list.

## Lo que había (investigación)

- **Lotes de exportación**: tabla `lotes`, columna `clase` (`exportacion`: LOTE 1 a 4; `trabajo`: BGPP, BGYP, PCPP, PCYP, LOTE MPP; `otro`) de `migration_inventario_rediseno_fase1.sql`. Regla de categorías (`backend/src/utils/lotes-categoria-toma.ts`): PGM solo usa el lote de catalizadores (LOTE 4); PCB y las demás usan todos menos ese. El packing list es de PCB, así que no se ofrece LOTE 4.
- **Stock por lote y almacén**: RPC `stock_lote_por_almacen(p_lote_id)` (la misma que usa el panel de Lotes en Inventario). Es derivado de compras, traslados, transformaciones y ajustes; nunca editable.
- **Edición de lotes**: `frontend/src/features/lotes/LoteFormModal.tsx` (botón «Editar lote» en el detalle del lote, Inventario). `PATCH /api/lotes/:id` exige `productos:editar`; clase y precio solo superadmin.
- **Packing list**: `packing_list_items.lote` y `.color` son texto (color = clave de `COLORES_LOTE`). `guardar_packing_list` reemplaza todos los ítems en una transacción. La proyección y los resultados se identifican por el texto del lote (por eso el lote seguirá guardándose como texto).
- **PDF**: `frontend/src/services/packing-list-export.ts` (ES/EN) dibuja solo campos explícitos del ítem; no recorre el objeto.
- **Fotos del sistema**: `POST /api/uploads/:tipo` sube a buckets PÚBLICOS (URL pública permanente). Para las fotos de paletas se pidió privado, así que se hizo un bucket y un endpoint propios.
- **Sin conexión**: la cola (`frontend/src/lib/offline`) guarda las fotos en IndexedDB y las sube siempre a `/api/uploads/tickets` (público). Reutilizarla obligaría a tocar el motor común de la cola.

## Decisiones

### Lote seleccionable (pedido 2)
- Endpoint `GET /api/packing-lists/lotes-exportacion` (permiso `despachos:ver`). Con permiso de inventario (`productos:ver`, el mismo de `/api/inventario`) o `facturacion:ver` devuelve una opción por **lote y almacén** con `disponibleKg`, `almacenNombre`, `colorPredeterminado` y `valor`. **Sin ese permiso** devuelve una sola opción por lote (nombre, valor y color) con `almacenId`, `almacenNombre` y `disponibleKg` en `null`, y ni siquiera lee el stock: el selector sigue funcionando pero sin kg ni almacén y sin control de exceso.
- Si falla la lectura del stock de un lote, la opción de ese lote sale con `disponibleKg: null` y `disponibilidadNoLeida: true` (antes se mostraba como 0 kg y generaba un falso aviso de exceso). El editor dice «no se pudo leer la disponibilidad» y no compara.
- `valor` es el texto que se guarda: «LOTE 1» se guarda como «1», igual que hasta ahora, para que los PDF sigan imprimiendo «LOT 1» / «LOTE 1» y la proyección no cambie.
- El almacén elegido se guarda en `packing_list_items.almacen_id` (el cliente pidió saber «de qué almacén lo estás trabajando»). Es nullable.
- Packing lists viejos: el texto libre se conserva sin migrar datos y se muestra en el selector como «X (guardado antes)». No se compara con inventario (no hay opción que coincida).
- Si la lista de lotes no carga (sin conexión y sin caché), el lote vuelve a escribirse a mano con un aviso, para no bloquear el trabajo.
- Excederse de lo disponible **no bloquea**: el bloque «Control interno de lotes» muestra kg del packing frente a lo disponible por lote y almacén, con aviso ámbar. Solo lectura: no descuenta ni mueve inventario. No se descuentan otros packing lists ya hechos con el mismo lote (el stock real baja cuando se registra el despacho).
- Disponible y almacén aparecen solo en el editor. Hay una prueba que falla si `packing-list-export.ts` menciona fotos, almacén o disponible.

### Color por lote (pedido 3)
- `lotes.color_packing_list` (clave de `COLORES_LOTE`, con CHECK). Se edita en «Editar lote» (permiso `productos:editar`; es cosmético, no exige superadmin).
- Al elegir un lote en el packing list, el color de la fila se rellena con el predeterminado (si tiene); sigue editable por fila. Si el lote no tiene color, la fila conserva el que tenía. `COLORES_LOTE` no cambia.

### Fotos por paleta (pedido 1)
- Bucket **privado** `packing-fotos` (6 MB y solo `image/jpeg`, `image/png`, `image/webp` configurados a nivel de bucket en la migración). `POST /api/packing-lists/fotos` (permiso `despachos:crear` o `editar` **y** permiso de control interno: `productos:ver` o `facturacion:ver`, porque quien no puede ver las fotos tampoco debe subirlas): el formato sale de la **firma real** del archivo y el tipo MIME declarado debe coincidir con ella, así que SVG y cualquier otra cosa se rechazan. Multer limita a 1 archivo, 0 campos de texto y 2 partes. Límite de 30 subidas por minuto por usuario (`fotosPackingLimiter`). Devuelve solo la ruta `pl/<uuid>.<ext>`.
- En la BD: `packing_list_items.fotos text[]` (máx. 5 por paleta, CHECK), solo rutas con ese formato (validado en Zod y en la función SQL). El detalle devuelve **URLs firmadas de 1 hora** (`createSignedUrls`); si no se pueden firmar, la foto queda listada con `url: null`.
- El front comprime la foto (`comprimirImagen`) y la sube **al agregarla**; el guardado del packing list lleva solo rutas, así no se rompe la cola sin conexión.
- Nunca van en el PDF.

### Compatibilidad con apps viejas y migración no aplicada
- Si el ítem no trae `fotos`/`almacen_id` (app vieja, cola vieja, o usuario sin permiso de control interno, a quien el backend le quita esas claves aunque las mande), `guardar_packing_list` conserva lo que tenía la paleta; con una lista vacía explícita (solo quien tiene permiso) sí las quita. El emparejamiento con la paleta anterior es por `numero_paleta` + lote cuando `numero_paleta` no es null (el número reinicia en cada lote), y por la posición `numero` solo cuando `numero_paleta` es null; detalle en la cabecera de la migración.
- Control interno por permiso: `GET /:id` y el guardado solo devuelven/escriben almacén, nombre de almacén y fotos (URLs firmadas) con `productos:ver` o `facturacion:ver`; sin ellos esos campos se omiten y ni se consultan sus columnas. El editor oculta la columna de fotos y el bloque de control interno.
- Backend nuevo sin migración: lectura y guardado como antes. Guardar con almacén o fotos responde 409 claro («falta aplicar migration_packing_list_lote_fotos.sql»), nunca se pierden en silencio (la función SQL anterior ignora claves desconocidas, por eso hay una sonda previa, patrón de `cliente_id`). El selector funciona sin color; editar el color del lote responde 409.

## Modo sin conexión (limitación documentada)
- Guardar el packing list con lote, almacén, color y rutas de fotos ya subidas funciona con la cola como siempre.
- **Subir una foto nueva requiere conexión.** Sin conexión el editor muestra «Sin conexión: la foto no se puede subir ahora…» y no agrega nada (no falla en silencio). No se metió en la cola de fotos porque esa cola sube a un bucket público fijo; hacerla configurable es un cambio del motor común, fuera de esta fase.
- Un packing list creado sin conexión muestra sus fotos ya subidas sin miniatura hasta que se envíe y se vuelva a cargar (no hay URL firmada local).

## Limitaciones conocidas
- Limpieza de fotos (best-effort): al guardar un packing list y al eliminarlo, el backend borra del bucket `packing-fotos` las fotos que estaban guardadas antes y que ya no están. **Criterio de seguridad**: solo son candidatas las rutas que antes estaban en alguna paleta de ese packing list; de ellas se borran únicamente las que **ninguna** fila de `packing_list_items` sigue referenciando (consulta `overlaps` tras guardar). Así no se borra una foto aún usada por otro packing list, ni una foto recién subida que todavía no se guardó (cola sin conexión), porque esas nunca estuvieron en una fila. Un guardado de una versión anterior no puede reintroducir una foto borrada porque la versión desactualizada responde 409 (PL409). Si el borrado falla solo se registra un aviso (cantidad y motivo, sin rutas ni datos personales) y la foto queda huérfana. Las fotos subidas y nunca guardadas (usuario que cierra el editor) siguen huérfanas: queda pendiente una limpieza periódica por antigüedad.
- Las URLs firmadas caducan a la hora; al recargar el packing list se firman de nuevo.
- La migración NO está aplicada. Hasta aplicarla, el bucket no existe y las fotos devuelven el aviso de «no habilitado».
