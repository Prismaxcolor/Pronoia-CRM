# Wallet: categorías, subcategorías y reportes

Pedido del cliente: una sección "Categorías" en el Wallet para clasificar ingresos y egresos, ver la categoría al registrar, filtrar movimientos por categoría, fecha y tipo, clasificar con colores, e imprimir reportes de una cuenta y de gastos por categoría.

## Datos (`docs/migration_wallet_categorias.sql`, rollback `_ROLLBACK.sql`; sin aplicar)
- `categorias_wallet`: dos niveles (`padre_id` nulo = categoría, con valor = subcategoría), `tipo` INGRESO / EGRESO / AMBOS, `color` hex `#RRGGBB`, `activo`. Nombre único dentro de su padre. Nunca se borra: archivar = `activo=false`.
- `movimientos.categoria_id` (nullable, FK `on delete restrict`). Históricos y transferencias quedan en `null` ("Sin categoría"); los pagos y cobros nuevos de proveedor y cliente se clasifican solos (ver Backend).
- Triggers con `search_path` vacío repiten las reglas del backend: máximo dos niveles, padre inmutable, el tipo del hijo cabe en el del padre, un movimiento solo recibe una categoría activa que acepte su tipo. RLS activo y deny-all para anon/authenticated; acceso solo por `service_role`.

## Backend (permiso del módulo `cochinito`: ver / crear / editar)
- `GET/POST /api/cochinito/categorias`, `PATCH /categorias/:id` (editar, archivar y restaurar; archivar una categoría archiva sus subcategorías). No hay DELETE.
- `POST /movimientos` acepta `categoriaId` (zod; rechazado en transferencias). Si falta la tabla responde 503 solo cuando se pide categoría; sin categoría el Wallet funciona igual.
- `PATCH /movimientos/:id/categoria`: cambiar solo la categoría de un ingreso o egreso manual vigente. Decisión: no pide llave de edición ni anulación porque no toca montos ni saldos; exige permiso `cochinito.editar` y acceso de edición a la cuenta (`exigirAccesoBancas`). Los movimientos de pago/cobro, anulados y transferencias se rechazan (409).
- Pagos y cobros del estado de cuenta (`docs/migration_categorias_uso.sql` + `docs/migration_categoria_pagos_cobros.sql`; sin aplicar): la tabla `categorias_uso` dice qué categoría lleva cada operación.
  - Pago a proveedor (`POST /api/pagos`, `/api/pagos/multiple`): categoría FIJA del uso `pago_proveedor` (COMPRA DE MATERIA PRIMA); se aplica sola a todas las filas de dinero del pago, incluido el adelanto por excedente. Un cruce puro no lleva.
  - Cobro a cliente (`POST /api/cobros/multiple`): se ELIGE entre las categorías del uso `cobro_cliente` (VENTA DE CHATARRA NF o PCB), con `categoriaId` en el cuerpo. Obligatoria si el cobro mueve dinero (bancas no vacías); un cruce puro no la lleva. Las opciones salen de `GET /api/cobros/categorias` (permiso `cochinito.crear`); si vienen vacías el modal no muestra el selector ni lo exige. Se valida antes de mover dinero.
  - La categoría se aplica con un update posterior a las filas devueltas por la RPC (`aplicarCategoriaAMovimientos`); si falla, el pago/cobro queda registrado y la respuesta trae `advertencia`. Si la tabla `categorias_uso` no existe o el uso no tiene categoría, todo funciona como antes, sin categoría.
  - Editar: `editar_pago_cobro_contable` borra y reinserta las filas; la migración nueva lee la categoría antes de borrar y la reaplica a las filas nuevas (solo si sigue vigente: el trigger rechaza insertar con una archivada, y eso no debe bloquear la edición). `editar_pago_cobro_campos` y `anular_pago_cobro` no tocan la categoría. Pendiente: no hay forma de cambiar la categoría de un cobro ya registrado (hay que anularlo y registrarlo de nuevo).
  - `PATCH /movimientos/:id/categoria` sigue rechazando (409) los movimientos de pago/cobro: su categoría se define al registrarlos.
  - Los reportes por categoría y por cuenta los incluyen sin cambios (filtran por tipo ingreso/egreso y no anulado, no por subtipo).
  - Históricos: `docs/correccion_categoria_pagos_cobros_historicos.sql` (opcional, sin aplicar) pone COMPRA DE MATERIA PRIMA a los egresos de pago/adelanto a proveedor ya registrados; los cobros históricos se dejan sin tocar.
- `GET /reportes/cuenta?bancaId&desde&hasta` y `GET /reportes/categorias?categorias=id,id&sinCategoria&desde&hasta`: lectura paginada (1000 por página), rango máximo 366 días, solo ingresos/egresos vigentes en el reporte de categorías. Respetan `puede ver` por cuenta: el de cuenta responde 403 si no hay acceso y enmascara la cuenta contraria ("Cuenta restringida"); el de categorías excluye las cuentas sin acceso e informa cuántos movimientos dejó fuera. Los totales van siempre por moneda (nunca se mezclan Bs y USD). Una categoría elegida incluye sus subcategorías; una subcategoría sola, solo esa.
- Con comisión bancaria (RPC propia) la categoría se aplica con un update posterior (`aplicarCategoriaSiFalta`); el cargo de comisión queda sin categoría.

## Frontend (`features/cochinito/categorias/`)
- Rutas `/cochinito/categorias` (crear, editar, archivar, colores) y `/cochinito/reportes` (PDF y "Ver e imprimir"), con la barra `NavegacionWallet` (Movimientos / Categorías / Reportes).
- Registrar movimiento: selector de categoría y subcategoría filtrado por tipo, sin valor predeterminado; hay que elegir una categoría o "Sin categoría". Si no hay categorías para ese tipo, el selector no aparece.
- Tabla de movimientos: columna con etiqueta de color (el nombre siempre va escrito), botón para cambiar la categoría, filtros de categoría y subcategoría combinables con tipo, fecha, banca y búsqueda. El filtrado es en el cliente porque `GET /movimientos` no pagina.
- PDF con el servicio `pdf-documento` (jsPDF + autotable).
