# Diseño: sección Exportaciones

Pedido del cliente: Exportaciones > Nueva exportación > elegir packing list y cliente internacional > valorar el packing list para la proyección de venta > resultados (proyección inicial frente al beneficio real).

## Qué es una exportación

Una exportación es un packing list con un cliente internacional vinculado (`packing_lists.cliente_id`, ya existe). No hay datos propios que duplicar: la valoración estimada y real por lote vive en `packing_lists.proyeccion` (jsonb) y los kg salen de las paletas.

## Decisión: sin tabla nueva ni migración

Se descartó la tabla `exportaciones` (id, packing_list_id único, cliente_id, estado...). Motivos:

- `cliente_id` y `proyeccion` ya cubren cliente y valoración; una tabla duplicaría el cliente y habría que mantener dos copias sincronizadas.
- El estado se deriva de la valoración, así que guardarlo sería un dato que se desactualiza.
- Sin migración no hay nada pendiente de aplicar ni compatibilidad extra. Si falta la columna `cliente_id` (migración `migration_packing_list_cliente_resultados.sql` sin aplicar), el listado responde vacío con `migracionPendiente: true` y la pantalla lo explica.
- Si más adelante hacen falta notas o varias exportaciones por packing list, se agrega la tabla entonces (YAGNI).

Estado derivado (lógica pura en `frontend/src/lib/exportaciones.ts`):

- Con resultado: al menos un lote tiene valor real cargado.
- Valorada: todos los lotes tienen valor estimado y ninguno tiene real.
- Borrador de valoración: cualquier otro caso (faltan estimados).

Los totales reutilizan `calcularResultados` (`lib/resultados-exportacion.ts`): total estimado, total real y diferencia solo suman los lotes con ambos valores.

## Backend

`GET /api/exportaciones` (permiso `despachos:ver`): packing lists con `cliente_id` no nulo (tope 200, más recientes primero). Devuelve cliente, contenedor, fecha, kg netos por lote. La valoración (`proyeccion`) solo viaja con `facturacion:ver`; sin ese permiso ni se lee de la BD. No hay rutas de escritura nuevas: el asistente guarda con `PUT /api/packing-lists/:id` (control de versión PL409, mismas validaciones de cliente internacional), por lo que no hay nada nuevo que catalogar en `grupo-eventos.ts`.

## Frontend

- Menú lateral: «Exportaciones» en la sección Pesaje, junto a Packing list, recurso `despachos`.
- `/exportaciones`: lista con cliente, packing list (contenedor y fecha), estado, total estimado, total real y diferencia (las tres últimas solo con `facturacion:ver`). Estado vacío con botón «Nueva exportación».
- `/exportaciones/nueva` y `/exportaciones/:id`: asistente de 3 pasos visibles. (1) Packing list y cliente: se elige un packing list existente (o se crea uno nuevo en el editor), el cliente se precarga si ya lo tiene, se puede cambiar, y si no hay clientes internacionales se enlaza a Clientes. (2) Valoración: componente `PackingListProyeccion` existente. (3) Resultados: componente `PackingListResultados` existente, con el valor real por lote manual.
- Los pasos 2 y 3 exigen `facturacion:ver` (como el editor); guardar exige `despachos:editar`. Toda la sección va dentro de `RequiereConexion` (usa datos que no están en la cola sin conexión). El editor del packing list no cambia; desde la lista y el asistente se puede abrir.
- El guardado reutiliza `construirEntrada`/`guardarPackingList` desde el detalle completo (`entradaDeExportacion`), para no perder paletas, fotos ni almacén.

## Sugerencia de valor real desde facturas de venta: NO se implementa

Se investigó (`facturas_venta`, `detalle_facturas_venta`, `packing_lists.referencia_tipo/referencia_id`) y no hay datos coherentes para asociar de forma fiable:

- Las líneas de factura de venta son por producto (`producto_id`, peso, precio unitario); no llevan lote, y el valor real del asistente es por lote del packing list. No existe forma de repartir una factura entre lotes sin inventar.
- La referencia del packing list a una factura (`referencia_tipo = 'factura_venta'`) existe en la BD pero ninguna pantalla la llena; en la práctica está vacía.
- Los precios de factura de venta no declaran moneda ni son USD/kg de exportación comparables con la proyección.

Por eso el valor real sigue siendo manual por lote. Para habilitar la sugerencia haría falta primero decidir cómo se vincula una factura a lotes (campo de lote en la línea o vínculo packing list - factura) y la moneda.
