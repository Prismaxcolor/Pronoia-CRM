# Plan de consolidación del inventario — Pronoia CRM

> Fecha: 11-sep-2026 · Rama: `Julio`
> **Regla de producto ya decidida por Julio (no se discute):** ningún movimiento se bloquea por falta de stock. Todo se registra siempre y el resultado se muestra tal cual sale, incluso negativo. Este plan sólo se ocupa de que ese número sea **uno solo y correcto**.

## 0. Resumen ejecutivo

El problema de fondo no es ninguno de los bugs individuales: el sistema **no tiene un libro mayor de inventario**. Cada pantalla reconstruye el stock desde las tablas crudas con su propia fórmula. Hoy hay **tres reconstrucciones independientes** (dos en TypeScript, una en SQL) más **una cuarta parcial en el frontend** para la composición proyectada. Cada bug nuevo aparece en una sola de ellas, se parcha ahí, y las otras quedan desalineadas.

- Causas raíz nuevas: **12** · Fases: **9** · Estimación: **35–44 h** (≈5 jornadas)

---

## 1. Mapa de los 5 flujos × 2 regímenes

Discriminador de régimen ya existente: `tipos_material.sin_lote` (`docs/supabase-schema.sql:4375`). `true` → Ferroso/No Ferroso/Aluminio (nunca lote). `false` → PCB (siempre lote).

### 1.1 Compra (`tickets_pesaje.tipo='compra'`)

| | PCB (con lote) | Sin lote |
|---|---|---|
| UI | `frontend/src/features/pesaje/PesajePage.tsx` → `material-fila.ts:118-125` decide destino según `sin_lote` | idem → `destinoTipo:'mpp'`, `loteId:null` |
| Servicio TS | `backend/src/services/ticket-pesaje-service.ts:240` `crearTicket()` → `materialesARpc()` (`:227-238`) | idem |
| Schema | `backend/src/schemas/tickets-pesaje.ts:4-34` | idem |
| SQL | `crear_ticket_pesaje` / `completar_ticket_pesaje` / `editar_ticket_pesaje`, vigentes en `docs/migration_fix_venta_valida_stock_disponible.sql:99, 209, 303` | idem (misma función) |
| Escribe | `tickets_pesaje` + `detalle_tickets_pesaje` (`destino_tipo='lote'`, `lote_id`) | `detalle_tickets_pesaje` (`'mpp'`, `lote_id=null`) |
| Lee stock | nada | nada |
| Almacén-aware | **NO** — `select id from almacenes where es_predeterminado and activo` (misma migración, `:117-120`) | **NO** |
| Bloqueo hoy | sólo "toma física abierta" (lock de flujo, se mantiene) | idem |

### 1.2 Venta (`tipo='venta'`)

| | PCB | Sin lote |
|---|---|---|
| Servicio TS | `ticket-pesaje-service.ts:240/275/299` (mismas 3 RPC que compra) | idem |
| Escribe | `detalle_tickets_pesaje` `destino_tipo='lote'` | `destino_tipo='mpp'` |
| Lee stock | `validar_stock_venta()` leía `stock_lote_por_producto()` **y** `stock_almacen()` | `stock_almacen()` |
| Almacén-aware | **NO** (heredado de compra) | **NO** |
| Bloqueo hoy | **eliminado** — hoy es `return;` vacío (`migration_remove_bloqueos_stock_insuficiente.sql:44-51`) | **eliminado** |

Nota: las 3 RPC **siguen llamando** a `validar_stock_venta()` (`migration_fix_venta_valida_stock_disponible.sql:160, 269, 379`). El no-op se dejó a propósito para no tocarlas.

### 1.3 Traslado (`tickets_traslado`)

| | PCB | Sin lote |
|---|---|---|
| Servicio TS | `traslado-service.ts:141` (`crear_traslado`), `:166` (`completar_traslado`) | idem |
| SQL | `crear_traslado()` vigente en `migration_remove_bloqueos_stock_insuficiente.sql:154`; `completar_traslado()` en `migration_fix_concurrencia_locks.sql:106` con el fix de `migration_fix_traslados_stock_pendiente.sql:64` | idem |
| **Soporte de lote** | **NO EXISTE** — `detalle_traslado` no tiene `lote_id` (`supabase-schema.sql:1972-1979`). Un lote PCB no se traslada; se cambia `lotes.almacen_id` a mano | N/A |
| Lee stock | `stock_almacen()` (ya no bloquea) | `stock_almacen()` |
| Almacén-aware | **SÍ** | **SÍ** |
| Bloqueo hoy | **eliminado** el de stock; se mantienen lock `FOR UPDATE`, toma física abierta, y "no recibir más de lo que salió" (`migration_fix_traslados_stock_pendiente.sql:113-115`) | idem |

### 1.4 Toma física

| | PCB (lote completo) | Sin lote (por producto) |
|---|---|---|
| Servicio TS | `toma-fisica-service.ts` (wrapper puro de RPC) | idem |
| SQL | `crear_toma_fisica_inventario`, `registrar_pesaje_toma_fisica`, `eliminar_pesaje_toma_fisica`, `resumen_toma_fisica`, `cancelar_toma_fisica_inventario` → **ninguna versionada**. Sólo `culminar_toma_fisica_inventario()` lo está (`migration_fix_concurrencia_locks.sql:182`, que ya incluye el prorrateo de `migration_fix_culminar_toma_fisica_prorrateo.sql`) | idem |
| Escribe | `ajustes_inventario` con `lote_id`+`almacen_id`: fila por producto escalada por `v_factor` + fila `producto_id=null` por el remanente (`:230-266`) | `ajustes_inventario` con `producto_id`, `lote_id=null` (`:218-222`) |
| Lee stock | `resumen_toma_fisica()` + `stock_lote_por_producto()` | `resumen_toma_fisica()` |
| Almacén-aware | **SÍ** (`backend/src/schemas/toma-fisica.ts:13`) | **SÍ** |

### 1.5 Transformación — hay **tres** variantes vivas, no dos

| | PCB (`/pcb`) | Legacy lote-pool (`/`) | Ferroso (`/ferroso`) |
|---|---|---|---|
| Ruta | `routes/transformaciones.ts:153`, `:168` | `:85`, `:100` | `:119`, `:134` |
| Servicio TS | `transformacion-service.ts:277`/`:302` | `:168`/`:210` | `:188`/`:232` |
| SQL | `crear_transformacion_pcb` / `completar_transformacion_pcb` — **NO versionadas hasta hoy** | `crear_transformacion()` en `migration_remove_bloqueos_stock_insuficiente.sql:60`; `completar_transformacion()` en `supabase-schema.sql:3282` | `crear_transformacion_ferroso()` en `migration_remove_bloqueos…:120`; `completar_transformacion_ferroso()` en `migration_fix_ferroso_validacion_salidas.sql:30` |
| Usada por el frontend | **SÍ** (`frontend/src/services/transformacion-service.ts:197`, `:213`) | **no** | **SÍ** (`:119`, `:135`) |
| Lee stock | `stock_lote_total` + `stock_lote_por_producto` | idem | `stock_almacen` |
| Almacén-aware | **NO** (`almacen_id` queda null) | **NO** | **SÍ** (`schemas/transformaciones.ts:35`) |
| Bloqueo hoy | **eliminado** (`migration_remove_bloqueo_transformacion_pcb.sql`, aplicado 11-sep tras encontrar el hueco en la auditoría) | **eliminado** | **eliminado** el de stock; se mantiene "salidas > entrada" |

### 1.6 Quién lee stock para mostrar

| Pantalla | Fuente | Archivo |
|---|---|---|
| `/inventario` general | recálculo TS #1 | `inventario-service.ts:293` `obtenerInventario()` |
| `/inventario` → Almacenes | recálculo TS #2 | `inventario-service.ts:577` (vía `routes/almacenes.ts:34`) |
| `/inventario` → Lotes, selector de lote | SQL | `lote-service.ts:75` y `:53` |
| Validaciones internas de RPC | SQL | `stock_lote_total`, `stock_lote_por_producto`, `stock_almacen` |
| Composición proyectada al completar PCB | recálculo frontend | `TransformacionesPage.tsx:719` |
| Stock por almacén de un producto | SQL | `almacen-service.ts:176` |

---

## 2. Catálogo de causas raíz

Severidad: **A** cifras equivocadas hoy · **B** impide operar / esconde el error · **C** deuda que garantiza la reaparición.

### Ya confirmadas antes de esta auditoría

**RC-1 (A) — Tres implementaciones independientes de stock.** SQL (`stock_lote_total`/`stock_lote_por_producto`/`stock_almacen`), `obtenerInventario()` (`inventario-service.ts:293-555`), `obtenerInventarioAlmacen()` (`:577-682`). Ninguna llama a las otras.

**RC-2 (A/B) — Compras/ventas clavadas al almacén predeterminado.** `crear_ticket_pesaje` resuelve el almacén con `es_predeterminado` (`migration_fix_venta_valida_stock_disponible.sql:117-120`) y `crearTicketSchema` (`schemas/tickets-pesaje.ts:48-105`) ni acepta `almacenId`.

### Encontradas en esta auditoría (11-sep-2026)

**RC-3 (B, crítica — YA RESUELTA) — El fix de emergencia dejó afuera la ruta PCB, que es la que el frontend usa.** El primer fix del día (`migration_remove_bloqueos_stock_insuficiente.sql`) reemplazó `crear_transformacion()` (legacy, **sin uso desde el frontend**), `crear_transformacion_ferroso()` y `crear_traslado()`, pero **no** `crear_transformacion_pcb()` — la que el frontend realmente llama (`/api/transformaciones/pcb`). Corregido el mismo día con `migration_remove_bloqueo_transformacion_pcb.sql`, verificado en producción con rollback antes de aplicar.

**RC-4 (C, crítica) — Subsistemas enteros sin versionar.** Sin DDL en `docs/`: tablas `ajustes_inventario`, `tomas_fisicas_inventario`, `detalle_toma_fisica`; funciones `composicion_lote`, `resumen_toma_fisica`, `crear_toma_fisica_inventario`, `registrar_pesaje_toma_fisica`, `eliminar_pesaje_toma_fisica`, `cancelar_toma_fisica_inventario`, `hay_toma_fisica_abierta`. Es la razón estructural de que cada auditoría sea arqueológica.

**RC-5 (A) — `stock_almacen()` cuenta el material de lote pero nunca lo descuenta.** En `migration_fix_traslados_stock_pendiente.sql:40-46` suma **todas** las líneas de `detalle_tickets_pesaje` del almacén sin filtrar `destino_tipo` → una compra PCB suma al almacén *y* al lote. Pero cuando sale del lote por transformación PCB no lo resta: `:52-60` filtran `categoria='ferroso_no_ferroso'`. Y `:50` filtran `lote_id is null`, así que una toma física de lote nunca corrige el almacén. Desfase permanente y creciente.

**RC-6 (A) — La ubicación del lote y la de sus kilos divergen por diseño.** `lotes.almacen_id` existe y se edita (`lote-service.ts:119`) pero ninguna función de stock lo usa; los kg se imputan a `tickets_pesaje.almacen_id`, que por RC-2 es siempre el predeterminado. Un lote de G1 aparece, en cifras, dentro de G2.

**RC-7 (A) — El inventario general ignora los traslados.** `obtenerInventario()` no consulta `tickets_traslado` ni `detalle_traslado` en ningún punto (`:293-555`). (a) un traslado pendiente resta del origen en `stock_almacen()` y no aparece en la vista global; (b) la merma (`peso_recibido < peso_neto`) desaparece del per-almacén pero el total global la sigue contando. La suma de almacenes nunca cuadra con el global.

**RC-8 (A) — Filtros de fecha aplicados a la mitad de las fuentes.** En `obtenerInventario()` el filtro se aplica a tickets (`:302-303`), retiros (`:337-338`), salidas ferroso (`:364-365`) y salidas a lote (`:413-414`, `:448-449`), pero **no** a `ajustes_inventario` (`:462-465`, `:485-489`) ni a los retiros sin producto (`:492-495`). Con filtro de fechas la columna "Ajuste" mezcla otra ventana temporal.

**RC-9 (C) — Dos definiciones de "peso neto".** `detalle_tickets_pesaje.peso_neto` = `bruto - tara - coalesce(devolucion,0)` (`supabase-schema.sql:707`) vs `detalle_traslado.peso_neto` = `bruto - tara` (`:1979`). Hoy inocuo (validaciones en no-op), reaparece al reactivar el cálculo.

**RC-10 (A/B) — La composición del lote está desacoplada de su stock.** `composicion_lote()` devuelve % sobre productos con `stock > 0`, y el frontend la muestra siempre que `composicion.length > 0`, sin mirar kg: `LotesPanel.tsx:190`, `InventarioPage.tsx:398`, `TransformacionesPage.tsx:642` y `:844`, `ConteoTomaFisicaPage.tsx:281` y `:322`, `TomaFisicaDetallePage.tsx:25`. Dos escenarios simétricos rotos:
- Lote con total 0 pero productos en +X/−X (sobreventa): sigue mostrando composición sobre un pool vacío. **Éste es el síntoma que reportó Julio.**
- `culminar_toma_fisica_inventario()` sólo prorratea si `stock_teorico > 0.01` (`migration_fix_concurrencia_locks.sql:230`); si el lote ya estaba en 0/negativo y el conteo da kg, inserta un único ajuste `producto_id=null` (`:263-265`) → lote con kilos y **sin** composición.

**RC-11 (A) — Dos cifras del mismo lote en la misma tarjeta.** `InventarioPage.tsx:392-393` muestra `g.totalKg` (fuente TS) y `:404` prorratea la composición sobre `g.stockLote ?? g.totalKg`, con `stockLote` de `stock_lote_total()` (fuente SQL, asignado en `:136`). La divergencia queda impresa en pantalla sin que nadie la note.

**RC-12 (C) — La herencia de composición está escrita tres veces.** CTE `salida_distribuida` (`migration_fix_composicion_lote_destino_transformacion.sql:43-54`), su clon en TS (`inventario-service.ts:405-428`), y `proyectarComposicion()` (`TransformacionesPage.tsx:719-743`).

**RC-13 (C) — `obtenerInventarioAlmacen()` tiene una tercera semántica.** Colapsa lote y sin-lote en un único bucket `'mpp'` (`:583-589`), excluye productos sin movimiento (`:681`) y excluye transformaciones PCB — hace que la vista por almacén y la general **no sean comparables por construcción**.

**RC-14 (C) — Overloads de RPC.** `hay_toma_fisica_abierta()` se llama con 3 args desde `crear_ticket_pesaje` y con 2 desde `crear_traslado`. Mismo riesgo que ya se limpió a mano en `validar_stock_venta` — falta auditar el resto vía `pg_proc`.

---

## 3. Hipótesis para los dos síntomas pendientes

### S-1: "Transformé 250 kg y el destino no refleja el cambio"

**H1 (alta confianza):** la transformación quedó en `'bruto'` y nunca se completó — antes de hoy, probablemente bloqueada por el mismo tipo de error que bloqueó la venta de aluminio (RC-2/RC-3). En ese estado el material **ya salió** y **todavía no llegó**:
- `stock_almacen()` resta la entrada sin filtrar estado pero suma la salida sólo con `estado='completa'`.
- `obtenerInventario()` hace lo mismo.

**H2:** si sí se completó y el destino es un lote PCB, revisar RC-5 (la llegada al lote no se refleja en el almacén).

**Cómo cerrarlo (primer paso del plan, sólo lectura):**
```sql
select t.id, t.categoria, t.estado, t.fecha, t.peso_neto,
       p.nombre as producto_entrada, l.nombre as lote_origen, a.nombre as almacen
from transformaciones t
left join productos p on p.id = t.producto_entrada_id
left join lotes     l on l.id = t.lote_origen_id
left join almacenes a on a.id = t.almacen_id
where t.estado = 'bruto'
order by t.fecha desc;
```
Con los bloqueos ya quitados (incluido PCB), conviene volver a intentar la transformación real y confirmar si ahora se completa correctamente antes de asumir que hace falta más trabajo aquí.

### S-2: "Toma física en cero → el lote no debería tener composición"

Es RC-10. No es un bug aislado: es una regla de negocio nunca implementada. Ninguna de las 7 pantallas que muestran composición consulta el stock antes de renderizarla. **Regla propuesta (confirmar con P-6):** si `stock_lote_total(lote) <= 0`, el lote no tiene composición — implementado en un solo punto (`composicion_lote()`), no en 7 pantallas.

---

## 4. Diseño de la fuente única de verdad

### 4.1 El núcleo: una vista de movimientos

Todo el stock sale de 6 tablas: `detalle_tickets_pesaje`, `detalle_traslado`, `transformacion_entrada_detalle`, `transformacion_salida_detalle`, `ajustes_inventario` y sus cabeceras. Propuesta: una vista normalizada con una fila por movimiento y el signo ya aplicado:

```
v_movimientos_inventario(
  origen        text,      -- 'compra'|'venta'|'traslado_salida'|'traslado_entrada'|'traslado_merma'
                            -- |'transformacion_entrada'|'transformacion_salida'|'ajuste_toma_fisica'
  referencia_id uuid,
  fecha         date,
  producto_id   uuid,      -- NULL = masa sin clasificar (se conserva, no se descarta)
  almacen_id    uuid,
  lote_id       uuid,      -- NULL = "sin lote" (MPP)
  kg            numeric,   -- con signo
  confirmado    boolean    -- false = pendiente/bruto
)
```

Con eso, **todas** las cifras pasan a ser un `GROUP BY`:

| Función | Se convierte en |
|---|---|
| `stock_almacen(a)` | `where almacen_id=a group by producto_id` |
| `stock_lote_total(l)` | `where lote_id=l` → `sum(kg)` |
| `stock_lote_por_producto(l)` | `where lote_id=l and producto_id is not null group by producto_id` |
| `stock_global()` **(nueva)** | `group by producto_id` — hoy **no existe ninguna función SQL que dé el total real sin importar almacén** |
| `inventario_detallado()` **(nueva)** | `group by producto_id, almacen_id, lote_id, origen` — exactamente las columnas Entradas/Salidas/Transf./Ajuste de `/inventario` |

Resuelve RC-1, RC-7, RC-8, RC-13 de raíz; hace visible y corregible RC-5/RC-6 en un solo lugar; elimina RC-12. El campo `confirmado` permite mostrar inventario "físico" y "disponible" sin bifurcar lógica, y resuelve S-1 explícitamente en vez de que el material se evapore.

### 4.2 Los servicios TypeScript dejan de calcular

- `obtenerInventario()` (~260 líneas) → llamada a `inventario_detallado()` + `construirGruposInventario()` (esta última se conserva: es presentación, no cálculo).
- `obtenerInventarioAlmacen()` → `inventario_detallado(almacenId)`, eliminando el colapso lote→mpp.
- `lote-service.ts` y `almacen-service.ts` no cambian (ya leen RPC).
- `proyectarComposicion()` se conserva sólo como *preview*, marcada explícitamente como no-fuente-de-verdad.

### 4.3 La disyuntiva: ¿ventas/compras almacén-aware?

**Opción A — quitar el almacén del ticket.** El `almacen_id` pasa a ser sólo trazabilidad.
*A favor:* mínimo cambio, cero fricción, alineado con "no bloquear".
*En contra:* `stock_almacen()` queda permanentemente equivocada, lo que vuelve ficticios los traslados y las tomas físicas por almacén — los dos flujos que *sí* son almacén-aware hoy.

**Opción B — agregar selector de almacén.**
*A favor:* único camino por el que `stock_almacen()` puede ser correcta y la toma física por almacén tenga sentido; alinea los 5 flujos.
*En contra:* un campo más en pesaje; hay que decidir qué hacer con el histórico.

**Recomendación: Opción B, con tres matices que eliminan casi toda la fricción:**
1. El selector viene precargado con el predeterminado; si sólo hay un almacén activo, ni se muestra.
2. El almacén se usa **sólo para trazabilidad y stock por almacén, nunca para validar disponibilidad**. La regla de Julio queda intacta.
3. La disponibilidad mostrada al vender es la **global** (`stock_global()`), con el desglose por almacén como información secundaria ("500 kg, 500 en G1").

Es decir: pool global para *vender* (como piensa Julio), por almacén para *saber dónde está* (como necesita la operación). Hoy el sistema tiene lo peor de ambas: valida por almacén y no deja elegirlo.

Si Julio responde que no quiere campo nuevo (P-1), el plan cae a la Opción A y se ahorra la Fase 5 (−6 a −8 h), pero hay que **dejar escrito** que el inventario por almacén queda como orientativo.

---

## 5. Plan de ejecución por fases

**Metodología de verificación:** el proyecto no tiene suite de tests para SQL y montarla sería falso rigor. Cada fase se valida con **consultas de sólo lectura contra producción antes/después**, más un **script comparador de fuentes** (`backend/scripts/verificar-stock.ts`, versionado en vez de crear-y-borrar).

### Fase 0 — Traer a tierra lo que realmente corre · 2–3 h
1. Extraer con `pg_get_functiondef` el cuerpo real de todas las funciones de inventario y volcarlas una por archivo en `docs/sql/functions/`.
2. Extraer DDL de `ajustes_inventario`, `tomas_fisicas_inventario`, `detalle_toma_fisica`.
3. Detectar overloads huérfanos (RC-14).
4. Registrar qué versión está viva de cada función.

**Verificación:** el conteo de funciones extraídas coincide con las RPC invocadas desde `backend/src/services/*.ts`.
**Por qué primero:** sin esto todo lo demás se diseña sobre suposiciones.

### Fase 1 — Confirmar S-1 ahora que los bloqueos ya no existen · 0,5–1 h
Con el bloqueo de PCB ya corregido, correr la consulta de transformaciones en `'bruto'` y, si Julio puede, repetir en vivo la transformación de 250 kg que reportó. Puede que este síntoma ya no reaparezca — confirmar antes de invertir más tiempo aquí.

### Fase 2 — Construir la vista de movimientos (sin cambiar consumidores) · 6–8 h
1. Crear `v_movimientos_inventario` con decisiones codificadas explícitamente (ver diseño arriba): almacén del lote desde `lotes.almacen_id` (RC-6), líneas de lote no cuentan como stock suelto del almacén (RC-5), traslados con merma como fila propia (RC-7), transformaciones con `confirmado=(estado='completa')` para salidas (S-1), fechas siempre pobladas (RC-8).
2. Crear `stock_global()` e `inventario_detallado(p_almacen_id uuid default null)`.
3. `verificar-stock.ts`: compara las 3 fuentes actuales contra la vista, imprimiendo sólo diferencias > 0,01 kg.

**Verificación:** toda diferencia debe quedar **explicada por escrito**, no "ajustada". Nada cambia de comportamiento en producción en esta fase.

### Fase 3 — Funciones SQL de stock como proyecciones de la vista · 4–5 h
1. Reescribir `stock_lote_total()`, `stock_lote_por_producto()` y `stock_almacen()` sobre la vista.
2. Documentar cada cifra que cambie (RC-5/RC-6) con antes/después y causa, para revisar con Julio.

**Verificación:** `verificar-stock.ts` antes/después → diferencias vacías. Snapshot previo de sólo lectura para revisar con Julio antes de aplicar.

### Fase 4 — Los servicios TS dejan de recalcular · 5–6 h
1. `obtenerInventario()` → `inventario_detallado()` + `construirGruposInventario()`.
2. `obtenerInventarioAlmacen()` → `inventario_detallado(almacenId)`, elimina RC-13.
3. RC-11: la tarjeta de lote muestra un único número.
4. Filtro de fechas pasa a la función SQL (RC-8).

**Verificación:** comparador sin diferencias; `npm run typecheck` + `npm run build` real en backend y frontend; revisión visual con y sin filtro de fechas.
**Cierre:** no queda aritmética de stock en TypeScript. RC-1 deja de existir.

### Fase 5 — Almacén-aware en compras y ventas · 6–8 h *(condicionada a P-1)*
1. `crearTicketSchema` gana `almacenId` opcional.
2. `crear_ticket_pesaje()` gana `p_almacen_id` con fallback al predeterminado (retrocompatible).
3. Selector visible sólo si hay más de un almacén activo.
4. Disponibilidad informativa = global, desglose por almacén debajo. Nunca bloquear.
5. Decidir el histórico (P-2).

**Verificación:** ticket de compra eligiendo G1 con rollback → refleja correctamente; comparador sin diferencias.

### Fase 6 — Composición coherente con el stock · 3–4 h
1. `composicion_lote()`: si `stock_lote_total(lote) <= 0`, devolver vacío (RC-10, S-2).
2. `culminar_toma_fisica_inventario()`: cuando el lote ya estaba en 0/negativo y el conteo da kg, repartir sobre la composición previa si existe.
3. Frontend: donde se evalúa `composicion.length > 0`, agregar la condición de stock.

**Verificación:** lote con stock ≤0 → composición vacía antes/después; toma física simulada con rollback.

### Fase 7 — Higiene de convenciones · 3–4 h
1. RC-9: una sola definición de "neto" documentada.
2. RC-14: eliminar overloads huérfanos.
3. Convención "no aplica": `null` en todas las capas, nunca `''` ni `undefined`.
4. UI: leyenda de que un negativo es real y esperado bajo la política de no bloquear.

### Fase 8 — Guardarraíl permanente · 2–3 h
1. `verificar-stock.ts` versionado con `npm run verificar:stock`.
2. Documentar en `docs/DEVELOPMENT.md` que todo cambio a una función de inventario exige correrlo antes y después.
3. Invariantes automáticas: suma de `stock_almacen()` + suma de `stock_lote_total()` ≈ `stock_global()`; ningún `lote_id` en filas `destino_tipo='mpp'`; ninguna transformación en `'bruto'` con más de N días.

### Resumen de fases

| Fase | Objetivo | Horas | Depende |
|---|---|---|---|
| 0 | Versionar lo que realmente corre | 2–3 | — |
| 1 | Confirmar S-1 con los bloqueos ya quitados | 0,5–1 | — |
| 2 | Vista `v_movimientos_inventario` + `stock_global()` + comparador | 6–8 | 0 |
| 3 | Funciones SQL como proyecciones de la vista | 4–5 | 2 |
| 4 | Servicios TS dejan de recalcular (elimina RC-1) | 5–6 | 3 |
| 5 | Almacén-aware en compras/ventas (RC-2) | 6–8 | 4, P-1 |
| 6 | Composición coherente (RC-10, S-2) | 3–4 | 3 |
| 7 | Higiene de convenciones (RC-9, RC-14) | 3–4 | 4 |
| 8 | Guardarraíl permanente | 2–3 | 4 |
| | **Total** | **35–44 h** | |

Las fases 0 y 1 pueden ir en paralelo — la 1 es casi gratis y puede cerrar uno de los dos síntomas pendientes hoy mismo.

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Las funciones no versionadas (RC-4) sean distintas a lo que asumen las migraciones | Fase 0 es bloqueante: nada se diseña hasta tener el cuerpo real |
| Corregir RC-5/RC-6 cambie números que Julio daba por buenos | Fase 3 produce tabla explícita antes/después por lote y almacén, para revisarla con él antes de aplicar |
| Reescribir `obtenerInventario()` rompa `/inventario` en producción | El comparador de Fase 2 corre contra la vista nueva mientras el servicio viejo sigue sirviendo |
| Concurrencia durante la migración | Los locks `FOR UPDATE` existentes se conservan tal cual; la vista es de sólo lectura |
| Alcance creciente | Cada fase tiene criterio de cierre escrito; nada fuera de él entra en la fase |

---

## 7. Preguntas abiertas para Julio

**P-1 · ¿Quieres poder elegir el almacén al comprar y al vender?** Hoy el sistema siempre asume ALMACEN G2, aunque el material esté en G1 — por eso "no existía" el aluminio. Se puede agregar un selector que ya venga con G2 puesto (si no lo tocas, todo sigue igual). Es la única forma de que el inventario por almacén sea confiable. ¿Lo agregamos, o prefieres que el sistema no distinga almacenes al comprar/vender y el número por almacén quede como referencia aproximada?

**P-2 · Si lo agregamos, ¿qué hacemos con lo ya registrado?** Todas las compras y ventas anteriores quedaron en G2. ¿Las dejamos así, o corregimos las anteriores para que digan dónde estaba realmente el material?

**P-3 · Al vender, ¿qué número quieres ver?** El total del negocio ("tienes 500 kg"), o el total con detalle de dónde está ("500 kg: 500 en G1, 0 en G2"). Ninguna opción te va a impedir vender.

**P-4 · Los traslados hoy no mueven lotes de PCB**, sólo materiales sin lote. Si mueves un lote de PCB entre almacenes, hoy hay que editarlo a mano. ¿Necesitas trasladar lotes de PCB de verdad?

**P-5 · Devoluciones en traslados.** En compras/ventas el peso neto descuenta la devolución; en traslados ese concepto no existe. ¿Alguna vez devuelves material dentro de un traslado?

**P-6 · Un lote que quedó en cero, ¿debe perder su composición?** Propuesta: que deje de mostrar "60% MIXTO I, 40% CENTRALES" y muestre "lote vacío". ¿Es lo que esperas? ¿Y si el lote va a volver a llenarse con lo mismo, prefieres que recuerde la última composición como referencia?

**P-7 · Material "sin clasificar" dentro de un lote.** Al transformar, a veces quedan kilos que el sistema no sabe a qué material asignar; hoy aparecen como línea aparte. ¿Te sirve así, o prefieres reparto automático entre los materiales que ya tiene el lote?

**P-8 · Transformaciones a medio hacer.** Cuando creas una transformación pero no la completas, el material ya salió del origen y no llegó al destino: desaparece del inventario hasta que la completes. ¿Quieres que el sistema te avise de transformaciones sin completar hace varios días, y que mientras tanto se muestre como "en proceso" en vez de desaparecer?

**P-9 · Merma en traslados.** Si despachas 1.000 kg y recibes 980, hoy esos 20 kg desaparecen del inventario por almacén pero siguen contando en el total general. ¿Quieres que queden registrados como pérdida visible, o que simplemente se descuenten?

---

## Estado al cierre de esta auditoría (11-sep-2026)

- RC-3 (transformaciones PCB seguían bloqueadas después del primer fix del día) ya está corregido y verificado en producción.
- Nada más de este plan se ha ejecutado todavía — es la base para decidir con Julio antes de tocar más código.
