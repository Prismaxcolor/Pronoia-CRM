# Diseño: inventario filtrado por fecha (saldo en kg al cierre de un día)

Pedido del cliente: "cuando se filtra en un inventario por fecha, la información que aparezca son los kilos que tenía ese inventario para esa fecha".

## Situación actual (investigada, solo lectura)

- No existe una tabla de stock: el stock es DERIVADO de movimientos. `obtenerInventarioAlmacen(almacenId)` (backend/src/services/inventario-service.ts) suma por almacén: compras y ventas (`tickets_pesaje`/`detalle_tickets_pesaje`), traslados (`tickets_traslado`: sale al crearse, entra al completarse por lo recibido), transformaciones (`transformacion_entrada_detalle` resta; `transformacion_salida_detalle` suma solo con la transformación `completa`) y ajustes de toma física/vaciar desechos (`ajustes_inventario`, con signo). La aritmética pura está en `utils/movimientos-almacen.ts` + `inventario-almacen-desglose.ts`. Las mermas (de transformación y de traslado) quedan implícitas (entró menos de lo que salió). El stock actual de TODA la pantalla (resumen, detalle, tarjetas) sale de esa función.
- La pantalla `/inventario` (InventarioNuevoPage) usa los endpoints `GET /api/inventario/resumen` y `/pantalla/{detalle,categorias,alertas}`. Su filtro desde/hasta solo acota despachos y merma del período; los kg en galpón son SIEMPRE los de ahora (lo dice el contrato en shared/types/inventario-pantalla.ts). Eso es lo que hay que corregir.
- `GET /api/inventario?desde&hasta` (legado) suma el neto de la ventana, no el saldo.

## Fuente del saldo a una fecha

Saldo al cierre del día D (inclusive) = la MISMA suma de movimientos, contando solo los movimientos con día de negocio <= D (`hasta = D`, sin `desde`). Así saldo(hoy) coincide por construcción con el stock actual. Se pide como `al=YYYY-MM-DD`; el frontend lo envía cuando el `hasta` del filtro es anterior a hoy.

Reglas de fecha de cada movimiento (zona America/Caracas, `diaNegocio()`):
- ticket de compra/venta: `tickets_pesaje.fecha` (columna date).
- traslado: salida en `created_at`; entrada en `completado_en` (instantes convertidos a día de negocio; antes se cortaba el ISO en UTC y un movimiento de la noche caía al día siguiente).
- transformación: retiro de entradas en `fecha`; salidas en `completado_en` (día en que se completó), o `fecha` si no hay.
- ajuste de inventario: `created_at` como instante de negocio.
- embalajes (listo/en saca): vigente al día D si `marcado_en` <= D y no estaba anulado a D (`anulado_en` > D).
- No se cuentan anulaciones borradas: lo anulado nunca suma (los tickets no se anulan; las filas anuladas de embalaje se evalúan por fecha).

## Qué NO se puede reconstruir con exactitud (se avisa en pantalla)

1. Ediciones de pesos posteriores (editar ticket, editar traslado, editar pesos de transformación): se guarda solo el valor vigente; el saldo histórico usa el peso corregido, no el que se conocía ese día.
2. Fechas editables o con fecha atrasada (ticket con fecha anterior a su registro, ticket "bruto" recepcionado después): aparece en el día de su fecha aunque se cargó después.
3. Traslados o transformaciones eliminados/revertidos después de D desaparecen del historial.
4. Antes del primer registro del sistema (2026-09-16 según los datos) el saldo es 0 porque no hay movimientos, no porque no hubiera material: se avisa.
5. Saldo negativo en un renglón (se vendió antes de que se registrara la compra): se muestra tal cual y se avisa.
6. Costos y valores: se calculan con costos de hoy, así que con fecha se ocultan (solo kg).
7. Composición de lote, alertas y días en inventario "de hoy" no aplican a una fecha pasada: se deshabilitan o se recalculan con los movimientos hasta D (los días se rotulan "estimado").

## Cómo se avisa

La respuesta trae `saldoAl` (fecha efectiva o null) y `avisos` con cada limitación detectada (datos antes del primer registro, saldos negativos, costos ocultos). La pantalla rotula "Saldo al dd/mm/aaaa", es solo lectura (se ocultan Registrar transformación, Gestionar, Vaciar desechos, Próximo contenedor, Alertas y la composición de lote) y muestra la nota de exactitud. Nunca se muestra un número sin su rótulo de fecha.

## Sin SQL nuevo

Todo sale de tablas existentes con consultas paginadas de solo lectura. La columna `transformaciones.completado_en` (la escriben las RPC `completar_transformacion*`) se lee con respaldo: si faltara, se usa `fecha` y se avisa.
