# Diseño: transferencias con mesa de cambio

Estado: implementado en la rama Julio (sin aplicar a ninguna base). Migración: `migration_mesa_cambio_transferencias.sql` (rollback en `_ROLLBACK.sql`).

## Cómo funciona hoy una transferencia

- Es una fila de `movimientos` con `tipo = 'transferencia'` creada con un INSERT directo (`crearMovimiento` en `banca-service.ts`).
- El saldo lo mueve el trigger `trg_aplicar_movimiento` (solo AFTER INSERT): origen `-monto`, destino `+coalesce(monto_destino, monto)`.
- Cada banca tiene una sola moneda (`USD` o `VES`). Si las monedas difieren, el usuario indica `monto_destino` (lo que entra al destino).
- Se anula con `anular_movimiento_banca` (revierte ambos saldos con `_aplicar_efecto_saldo` y marca `anulado`). `reconciliar_saldo_banca` recalcula saldos desde los movimientos no anulados.
- El correlativo MV lo asigna un trigger BEFORE INSERT a los movimientos sin `subtipo` ni `grupo_id`.

## Modelo de datos

`movimientos` (columnas nuevas, todas null en movimientos normales):

| Columna | Uso |
|---|---|
| `mesa_cambista_id` | cambista elegido; no nulo = transferencia con mesa |
| `mesa_estado` | `en_proceso` o `completada` (si `anulado`, la anulación manda) |
| `mesa_monto_bruto` | lo que el cambista debía entregar en el destino (moneda destino) |
| `mesa_comision_modo` / `mesa_comision_pct` / `mesa_comision` | modo (`porcentaje` o `monto`), porcentaje usado y comisión resultante (moneda destino) |
| `mesa_completada_at` / `mesa_completada_por` | quién y cuándo completó |

Se reutiliza `monto_usd` como el equivalente en USD de la operación (importe del asiento).

`cambista_asientos`: tipos `CARGO`, `COBRO`, `NC`, `ND`; `movimiento_id` (asiento ligado a una transferencia, un máximo de uno por tipo y movimiento); `numero_nota` (correlativo NC-0001 / ND-0001, secuencias propias). `MC-` sigue siendo el número global de todos los asientos.

## Estados y flujo

1. **Crear** (RPC `crear_transferencia_mesa_cambio`): valida cuentas, moneda, saldo del origen y comisión; inserta el movimiento `en_proceso` (el trigger descuenta el origen y NO acredita el destino) y el asiento CARGO por `monto_usd`. Todo en una transacción, con las bancas bloqueadas por id.
2. **Completar** (RPC `completar_transferencia_mesa_cambio`): bloquea el movimiento (`for update`); acredita el destino con `monto bruto - comisión`; estado `completada` con fecha y usuario; asiento COBRO por el mismo importe del CARGO (el cambista cumplió). Repetir la llamada no vuelve a acreditar (devuelve `yaCompletada`).
3. **Anular** (RPC `anular_transferencia_mesa_cambio`, motivo obligatorio): en proceso revierte solo el origen; completada revierte origen y destino (se rechaza si dejaría un saldo peor en negativo). Anula los asientos ligados. La ruta es la misma de siempre (`POST /movimientos/:id/anular`, con llave); el servicio elige la RPC.

Un trigger sobre `movimientos` impide anular o cambiar importes/cuentas de una transferencia con mesa por las RPC genéricas (editar contable, anular_movimiento_banca): solo las RPC de la mesa activan `app.mesa_cambio_rpc`. Mismo guardián para anular a mano los asientos ligados. Descripción, referencia, fecha y comprobantes siguen siendo editables.

## Cómo cuadran saldos y comisión

- La comisión **reduce lo acreditado**: el cambista entrega el bruto menos su comisión. Wallet refleja el dinero real; no hay movimiento aparte.
- El CARGO y el COBRO usan el importe bruto en USD, así el saldo del cambista vuelve a 0 al completar. La comisión se ve en el detalle de la transferencia.
- Para que el resto del sistema no cambie, al completar `monto_destino` pasa a ser el neto acreditado (`mesa_monto_bruto` conserva el bruto); `reconciliar_saldo_banca` y la reversión de saldos quedan correctas.
- Porcentaje: `comisión = round(bruto * pct / 100, 2)` sobre el monto bruto de destino. Monto manual: en la moneda del destino.

## Monedas

- Misma moneda: sin conversión. Monedas distintas: `monto_destino` explícito (como hoy; la tasa solo sugiere).
- El estado de cuenta del cambista es en USD: si origen o destino es USD se toma ese monto; si ninguno lo es (VES a VES), el usuario informa el equivalente en USD a mano (`montoUsd`).

## Rutas, permisos y detalles técnicos

- `POST /api/cochinito/movimientos/mesa-cambio` (crear; exige `cochinito:crear` y `mesa_cambio:crear`), `POST /api/cochinito/movimientos/:id/completar` (`cochinito:editar` y `mesa_cambio:ver`) y la anulación de siempre `POST /movimientos/:id/anular` (con llave), que elige la RPC según el movimiento. Las tres revisan el acceso por cuenta de origen y destino (`exigirAccesoBancas`), y fallan cerrado.
- Editar una transferencia con mesa: solo fecha, referencia, concepto y comprobantes (409 si intenta cambiar cuentas o montos).
- Los comprobantes se adjuntan con un `update` aparte tras la RPC (el tipo de `movimientos.comprobantes` es `text[]` o `jsonb` según el despliegue); si falla, la respuesta trae `advertencia` y la transferencia ya existe.
- El COBRO automático lleva como fecha el día de completar (hora de Venezuela); el CARGO, la fecha de la transferencia.
- Mesa de cambio: N/C y N/D se registran como cualquier asiento (nota obligatoria). Los asientos ligados a una transferencia no se anulan a mano (se anulan con la transferencia).
- Compatibilidad: sin la migración, el estado de cuenta y Wallet siguen funcionando (`select *`, campos `mesa_*` null); crear/completar responden 503 y N/C y N/D responden 503 al registrarse.

## Riesgos

- Interpretación del signo: el CARGO ("les debemos") queda abierto mientras la operación está en proceso y se salda al completar. Confirmar con el cliente si prefiere leerlo al revés.
- Anular una transferencia completada puede fallar por saldo insuficiente en el destino: es intencional.
- Con la migración sin aplicar, el backend responde 503 en crear/completar (no toca nada); las transferencias normales siguen igual.
- Acceso por cuenta: crear/completar/anular exigen acceso a origen y destino (falla cerrado).
