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

## C. Pagos a proveedor desde una cuenta en Bs (comisión, tasa y categoría)

Estado: implementado en la rama Julio (sin aplicar). Migraciones: `migration_pago_comision_bancaria.sql` (requiere la de comisión bancaria y `migration_editar_anular_transacciones.sql`) y `migration_categoria_comisiones_bancarias.sql` (requiere `migration_wallet_categorias.sql` y `migration_categorias_uso.sql`). Rollbacks `_ROLLBACK.sql`.

- **Comisión:** el modal "Registrar pago" (`PagoCobroModal` -> `FilaBancaPago` -> `LineaPagoBs`) reutiliza `ComisionBancariaCampo` y `comision-formulario` de Wallet. Es obligatorio elegir Sí o No en cada cuenta en Bs (si la comisión está habilitada; no hay valor por defecto). El saldo no limita la comisión: un pago a proveedor puede dejar la cuenta en negativo.
- **Cómo se carga:** `POST /api/pagos` y `/api/pagos/multiple` aceptan `llevaComision` (por cuenta). Tras registrar el pago (RPC de siempre, sin tocar), `pago-comision-service.ts` llama a `agregar_comision_bancaria_a_pago`, que crea el cargo (egreso en la misma cuenta, `comision_de_id` = movimiento del pago, concepto "Comisión bancaria 0.3% – PG-0012"). La base es todo lo que el grupo debita de esa cuenta (pago + adelanto); el cargo cuelga de la fila del pago (o del adelanto si solo hay adelanto). No es atómico con el pago: si el cargo falla, el pago queda y la respuesta trae `advertencia`.
- **Compatibilidad:** sin las migraciones, una cuenta en Bs se paga como siempre; pedir "Sí" responde 400 con aviso claro antes de mover dinero. Omitir la comisión (No) se audita (`sin_comision_bancaria`, entidad `pago`).
- **Anular:** `anular_pago_cobro` anula también el cargo (la migración reemplaza la función añadiendo ese paso). **Editar:** como en Wallet, con comisión no se cambian montos, cuentas ni facturas (409); concepto, referencia, fecha y comprobantes sí.
- **Tasa:** cada cuenta en Bs elige Binance, BCV (por defecto, como antes) o manual; las dos primeras vienen de `useTasasUsd` (las mismas del Wallet). Se muestra "USD x = Bs y (tasa ...)" y se envía el monto en Bs calculado a centavos. No se guarda la tasa (el pago ya guarda Bs y USD).
- **Categoría:** todo cargo de comisión (Wallet, pagos, nómina) lleva `COMISIONES BANCARIAS`. La migración la crea (subcategoría de GASTOS FINANCIEROS si existe), la registra en `categorias_uso` con el uso `comision_bancaria` y un trigger impone la categoría a todo movimiento con `comision_de_id` (también si nómina intenta ponerle otra). El backend la aplica además con `comision-categoria-service.ts` (por uso o, si falta, por nombre). Históricos: `correccion_categoria_comisiones_historicas.sql` (opcional) y `verificar_categoria_comisiones.sql` (solo lectura).
- **Fuera de alcance:** la comisión de la mesa de cambio no es un movimiento (reduce lo acreditado al destino) y los cobros son ingresos: no llevan comisión bancaria.
