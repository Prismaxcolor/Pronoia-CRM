# Diseño: Wallet, comisión bancaria 0.3% y equivalente en USD

Estado: implementado en la rama Julio (sin aplicar a ninguna base). Migración: `migration_wallet_comision_bancaria.sql` (rollback en `_ROLLBACK.sql`). Requiere `migration_editar_anular_transacciones.sql` y `migration_wallet_correlativo.sql`.

## A. Comisión bancaria (0.3%, mínimo 14 Bs)

- **Cuándo se ofrece:** egreso o transferencia cuya cuenta de origen es VES. Es obligatorio elegir Sí o No (sin valor marcado de inicio). No aplica a ingresos, cuentas en USD, pagos/cobros del estado de cuenta (otras RPC) ni transferencias con mesa de cambio (el interruptor se oculta al activar la mesa; tiene su propia comisión).
- **Fórmula:** `max(monto x 0.003, 14)` redondeada a centavos (mitad hacia arriba). Función pura en `shared/types/comision-bancaria.ts`, espejo en `backend/src/utils/comision-bancaria.ts` (el backend no resuelve `@shared`; un test exige que ambas den lo mismo). La RPC SQL repite la fórmula con `greatest(round(monto*0.003,2),14)` y es la autoridad.
- **Cargo:** la RPC `crear_movimiento_con_comision_bancaria` (security definer, `search_path` fijo, solo `service_role`) inserta el movimiento y, en la misma transacción, un egreso en la misma cuenta con concepto `Comisión bancaria 0.3% – MV-0001`. Valida cuenta, moneda VES y saldo para monto + comisión. El cargo recibe su propio correlativo MV.
- **Vínculo:** `movimientos.comision_bancaria` (en el principal) y `movimientos.comision_de_id` (en el cargo, único por principal).
- **Anular:** `anular_movimiento_con_comision_bancaria` anula cargo y principal juntos. Un trigger guardián (patrón de la mesa de cambio, GUC `app.comision_bancaria_rpc`) impide anular o cambiar importes/cuentas por las RPC genéricas, así nunca queda un movimiento sin su comisión ni al revés.
- **Editar (decisión):** en lugar de "ajustar" la comisión, se bloquean los cambios de monto/cuentas de un movimiento con comisión (409, igual que la mesa): se anula y se registra de nuevo. Concepto, referencia, fecha y comprobantes siguen editables. El cargo no se edita ni se anula suelto.
- **Compatibilidad:** `GET /api/cochinito/comision-bancaria` informa si la migración está aplicada (prueba la columna). Sin ella el interruptor no se ofrece y todo se registra como siempre; con `llevaComision: true` la API responde 503 con aviso claro.
- **API:** `POST /api/cochinito/movimientos` acepta `llevaComision` (opcional) y responde `{ movimiento, comision: { monto, movimientoId } | null, advertencia? }`. Errores con su código (400 falta elegir, 409 saldo/negocio, 503 migración pendiente). El catálogo de eventos de Telegram no cambia (misma ruta, mismo `movimiento`).
- **UI:** `ComisionBancariaCampo` (Sí/No), resumen con monto, comisión y total debitado; el saldo se valida contra el total.

## B. Equivalente en USD (solo visualización, no se guarda)

- Funciones puras `shared/types/equivalente-usd.ts` (`usdDesdeBs`, `equivalentesDeBs`); sin tasa válida devuelve null y la pantalla dice "tasa no disponible"; nunca se inventa ni se usa otra tasa.
- **Formulario de movimiento:** debajo del monto en Bs (y del monto destino si el destino es Bs), dos líneas: Binance y BCV, con la tasa usada y su fecha (día en hora de Caracas).
- **Tarjetas de cuentas en Bs:** saldo en Bs y debajo su equivalente a tasa Binance. **Saldo en bolívares** (total de las cuentas activas en VES): el total en Bs y su equivalente en USD (Binance).
- **Carga:** `useTasasUsd` en `CochinitPage` pide Binance y BCV una vez por pantalla y las pasa a tarjetas, indicador y formulario (nada de una petición por tarjeta). Reutiliza `obtenerTasa` (caché local y respaldo del servicio de tasas).

## Límites conocidos

- La fecha del cargo de comisión no sigue si se edita la fecha del movimiento principal.
- El cargo cuenta como egreso sin equivalente en USD en los indicadores del periodo (aparece en "sin equivalente en USD").
- La función SQL y la función TS duplican las constantes (0.003 y 14); si cambian, hay que cambiar ambas.
