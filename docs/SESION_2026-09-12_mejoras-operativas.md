# Sesión 12-sep-2026 — Mejoras operativas (Factura, Traslados, Inventario, Compra)

Rama: `Julio`. Commits: `db21094`, `5ca7163`.

Julio pidió 8 mejoras puntuales sobre 4 áreas del sistema, con énfasis explícito en
consolidar Inventario/Almacenes. Este documento deja registro de qué se hizo, cómo,
y por qué — para no tener que reconstruir el contexto en la próxima sesión.

## 1. Estado de las 8 peticiones originales

| # | Pedido | Estado |
|---|--------|--------|
| 1.1 | Vender por encima del stock disponible (queda negativo) | Ya resuelto el 11-sep (fix previo), sin cambios esta sesión |
| 1.2 | Vehículo en factura de venta | Hecho — ver §4 |
| 2.1 | Traslado de lotes (PCB), no solo material sin lote | Hecho — ver §5 |
| 2.2 | Foto en el pesaje de traslado | Hecho — ver §5 |
| 2.3 | Traslado reflejado en almacén de origen y destino | Ya resuelto el 11-sep, sin cambios esta sesión |
| 3.1 | Consultar inventario por almacén separado | Hecho — ver §2 |
| 4.1 | Ticket de pesaje: pesos individuales + total por material | Hecho — ver §6 |
| 4.2 | Factura de compra: solo el total consolidado por material | Hecho — ver §6 |
| 4.3 | Descuento de peso al facturar compra | Hecho — ver §6 |

## 2. Inventario y Almacenes consolidados (prioridad de la sesión)

**Problema:** existían dos pantallas con fórmulas distintas del mismo dato — la
pestaña "Inventario" (rica: entradas/salidas/transformaciones/ajustes/composición
de lote, pero sin noción de almacén) y la pestaña "Almacenes" (por almacén, pero
colapsando todo a un bucket "sin lote", sin desglose).

**Solución:** se llevó el filtro de almacén a la vista rica de Inventario
(`obtenerInventario({ almacenId })` en `backend/src/services/inventario-service.ts`),
en vez de seguir usando `obtenerInventarioAlmacen()` (que ahora solo la usa el
guardarraíl `npm run verificar:stock`). Regla de atribución: material sin lote se
atribuye al almacén del ticket/transformación/ajuste; material con lote (PCB) se
atribuye al almacén ACTUAL del lote (`lotes.almacen_id`) — mismo criterio que
`stock_almacen()` en SQL, para que ambas vistas sigan cuadrando siempre.

`AlmacenesPanel.tsx` se simplificó a solo gestión (crear/editar/activar/marcar
predeterminado) — ya no muestra un inventario propio.

**Bug real encontrado y corregido en el camino:** el filtro por almacén no
contaba los traslados porque la consulta pedía la columna `tickets_traslado.fecha`,
que no existe (esa tabla solo tiene `created_at`/`completado_en`) — Supabase
devolvía error, se ignoraba silenciosamente, y los traslados desaparecían del
cálculo. Corregido usando `created_at`/`completado_en` según corresponda.

**Verificación:** se corrió `stock_almacen()` (SQL) vs `obtenerInventario({almacenId})`
(TS) para ambos almacenes en un script ad-hoc — 0 discrepancias tras el fix.

## 3. Punto no ejecutado explícitamente pero relevante

No se tocó `docs/PLAN_consolidacion_inventario.md` — sigue siendo el documento de
referencia para el diseño de fuente única de verdad del inventario (Fases 0-8, ya
ejecutadas el 11-sep). Esta sesión construye sobre eso, no lo reemplaza.

## 4. Vehículo (evolucionó durante la sesión)

**Primera versión (commit `db21094`):** campo de texto libre `vehiculo` en
`tickets_pesaje`, solo para compra/venta.

**Ajuste pedido por Julio tras ver el formulario desplegado (commit `5ca7163`):**
- Vehículo pasa a ser un **catálogo seleccionable** — tabla `vehiculos` nueva
  (`id, nombre, activo, created_at`), con endpoints CRUD en `/api/vehiculos`
  (mismo patrón que `taras`) y un `<select>` + alta rápida inline en los
  formularios de pesaje y traslado.
- Se agregó el recurso `vehiculos` a la matriz de permisos
  (`backend/src/utils/permisos.ts` y su espejo `shared/types/usuario.ts`) con los
  mismos niveles de acceso que `taras` por rol.
- Vehículo ahora también aplica a **Traslado** (antes solo compra/venta) —
  columna `vehiculo` agregada a `tickets_traslado`.

## 5. Traslados: lote pesado + foto por pesada (evolucionó durante la sesión)

**Primera versión (commit `db21094`):**
- `detalle_traslado.lote_id` nuevo — permite trasladar un lote PCB completo.
- Diseño: el lote se traslada ENTERO (no parcial), y el peso se tomaba
  automáticamente de `stock_lote_total()` (snapshot), sin pesarlo de nuevo.
- Una sola foto general del traslado (`tickets_traslado.fotos`, requerida al crear).
- El lote sigue apareciendo en el almacén de ORIGEN mientras el traslado está
  `pendiente` — recién se atribuye al almacén DESTINO cuando se completa
  (`lotes.almacen_id` se actualiza en `completar_traslado()`). Se eligió este
  diseño (en vez de volver `lotes.almacen_id` nullable para representar
  "en tránsito") por ser mucho menos invasivo y más intuitivo para un activo
  discreto: el lote sigue estando físicamente donde estaba hasta que alguien
  confirma que llegó.

**Ajuste pedido por Julio (commit `5ca7163`):**
- El lote ahora se **pesa de verdad** (peso bruto + tara) al trasladarlo, en vez
  de asumir el stock teórico — más preciso y consistente con que todo en el
  sistema se pesa. `detalle_traslado.peso_bruto/tara` para una línea de lote
  ya no vienen de `stock_lote_total()`, vienen de lo que se pesó.
- **Foto por cada pesada** (material o lote), no una sola foto general —
  `detalle_traslado.fotos` (columna nueva, `text[]`) en vez de
  `tickets_traslado.fotos`. Se **revirtió** el uso de `tickets_traslado.fotos`
  en la creación: esa columna vuelve a ser exclusiva de la evidencia de
  RECEPCIÓN, como era antes de este cambio. Motivo: `completar_traslado()`
  sobrescribe esa misma columna con las fotos de recepción — si también se
  llenaba al crear, esas fotos de creación se perdían silenciosamente al
  completar el traslado. Este bug se detectó y corrigió antes de que llegara
  a producción real (se probó en transacción de prueba, sin persistir).

**Firma final de `crear_traslado()` en Supabase:**
```sql
crear_traslado(
  p_almacen_origen_id uuid, p_almacen_destino_id uuid, p_observaciones text,
  p_materiales jsonb,   -- [{producto_id, subcategoria, peso_bruto, tara, fotos[]}]
  p_pesado_por uuid,
  p_lotes jsonb DEFAULT '[]',  -- [{lote_id, peso_bruto, tara, fotos[]}]
  p_vehiculo text DEFAULT NULL
)
```

## 6. Compra: subtotales, factura consolidada, descuento de peso

- **4.1** — `TicketDetallePage.tsx`: fila de subtotal por material cuando el
  mismo material se pesó más de una vez en el ticket (dato ya existía, solo
  faltaba agruparlo en pantalla).
- **4.2** — `FacturaFormPage.tsx`: al armar la factura desde tickets
  seleccionados, las líneas se consolidan por `productoId` (sumando peso) en
  vez de generar una línea editable por cada pesada individual.
- **4.3** — nuevo campo `descuentoKg` por línea de factura de COMPRA (merma o
  tara adicional aplicada al facturar, no en el pesaje). Diseño: `peso` en
  `detalle_facturas_compra` sigue siendo el peso YA FACTURADO (bruto −
  descuento) para que la columna generada `subtotal` (peso × precio) no
  necesite tocarse; `descuento_kg` es una columna nueva solo informativa. Se
  preservó al reescribir `crear_factura_compra()` la validación existente de
  "no facturar si hay una toma física abierta" que no estaba documentada en
  `docs/sql/functions/` — se verificó contra la definición real en producción
  antes de sobrescribirla.

## 7. Migraciones aplicadas (en orden, todas ya corridas en Supabase producción)

1. `docs/migration_descuento_peso_factura_compra.sql`
2. `docs/migration_vehiculo_ticket_pesaje.sql`
3. `docs/migration_foto_traslado_salida.sql` (superada por la #5)
4. `docs/migration_traslado_lote_completo.sql` (superada por la #5)
5. `docs/migration_traslado_v2_foto_por_pesada_vehiculo_lote_pesado.sql` — deja
   `crear_traslado()`/`completar_traslado()` en su forma final; crea tabla
   `vehiculos`; agrega `tickets_traslado.vehiculo` y `detalle_traslado.fotos`.

Nota: las migraciones #3 y #4 quedaron en el repo como registro histórico de la
primera iteración, pero su contenido fue reemplazado por la #5 — para replicar
este trabajo en otro entorno, alcanza con aplicar 1, 2 y 5 (en ese orden; la 5
depende de que `detalle_traslado.lote_id` ya exista, así que debe aplicarse
después de una versión que la cree — revisar el DROP FUNCTION al inicio de cada
migración antes de reaplicar, ya usan `drop function if exists` con la firma
exacta anterior).

**Cada migración con cambio de firma de función** (parámetro nuevo agregado)
incluyó un `DROP FUNCTION` explícito de la firma anterior — `CREATE OR REPLACE`
por sí solo no reemplaza una función si la lista de parámetros cambia, deja un
segundo overload ambiguo. Se detectó esto en vivo durante la sesión (quedaron
dos versiones de `crear_ticket_pesaje` un momento) y se corrigió antes de seguir.

## 8. Verificación realizada

- `tsc --noEmit` (backend con `--rootDir ..`, frontend) limpio en cada tanda de
  cambios.
- `npm run build` real de frontend limpio (no solo typecheck).
- `npm run verificar:stock` (guardarraíl SQL vs TS de la Fase 8 del plan de
  consolidación) sin discrepancias, antes y después de todos los cambios de
  inventario.
- Cada función SQL modificada se probó en una transacción `begin; ... ;` sin
  `commit` contra producción (Management API de Supabase) antes de darla por
  buena — incluye un flujo completo crear→completar traslado de lote,
  confirmando que `lotes.almacen_id` se mueve al destino correctamente y que
  nada quedó persistido tras la prueba.

## 9. Pendiente / no incluido en esta sesión

- Nada quedó pendiente de las 8 peticiones originales ni de los 3 ajustes de
  vehículo/foto/lote-pesado.
- No se tocó la Fase 7 (limpieza de convenciones) del plan de consolidación de
  inventario del 11-sep — sigue diferida a propósito, bajo impacto.
