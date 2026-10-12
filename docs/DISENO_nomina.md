# Diseño: módulo de Nómina (fase 1: registro y cálculo)

Alcance: personal administrativo y operativo, nómina semanal por tipo, préstamos/adelantos. La fase 1 es REGISTRO Y CÁLCULO
(no mueve dinero); la fase 2 paga una nómina cerrada desde el Wallet (sección «Fase 2» al final).

## Permiso

Recurso nuevo `nomina` (acciones ver / crear / editar / eliminar). Por defecto SOLO superadmin; para otros usuarios se
asigna en Usuarios > permisos personalizados (fila "Nómina (personal)"). Todas las rutas `/api/nomina/*` lo exigen.
Mapa de acciones: ver = consultar; crear = trabajadores, préstamos, guardar borrador de nómina; editar = editar
trabajadores/préstamos, cerrar nómina, anular préstamo; eliminar = desactivar trabajador, anular nómina.

## Datos sensibles

Cédula, RIF, teléfono, dirección, contacto de emergencia, pago móvil y Binance solo salen por `/api/nomina/*`
(ningún otro módulo los consulta). Nada de esto va a logs (solo ids y códigos de error; los mensajes crudos de Postgres
pueden traer la cédula en una violación de unicidad, por eso nunca se registran ni se devuelven). Las rutas están en el catálogo de avisos a
Telegram (el test lo exige) pero como `ignorable`: nunca se avisan al grupo. Respuestas con `Cache-Control: no-store`. Todo lo que entra se valida con zod. En el
frontend la sección exige conexión (no se guarda en la caché sin conexión).

## Tablas (docs/migration_nomina.sql, con rollback)

| Tabla | Contenido |
|---|---|
| `nomina_trabajadores` | tipo (ADMINISTRATIVO/OPERATIVO), nombres, apellidos, cédula (única), RIF, teléfono, dirección, contacto de emergencia (nombre, teléfono), pago móvil (banco, teléfono, cédula), Binance (correo/ID), `pago_diario_usd`, `activo` (soft-delete). |
| `nomina_prestamos` | numero PRE-0001, trabajador, tipo PRESTAMO/ADELANTO, monto, `saldo_usd`, cuota semanal opcional, fecha, nota, estado ACTIVO/PAGADO/ANULADO, motivo de anulación. |
| `nomina_prestamo_movimientos` | Libro inmutable de cuotas: CUOTA (al cerrar) y REVERSA (al anular una nómina cerrada). Único por (préstamo, nómina, tipo): no hay doble descuento. |
| `nominas` | numero NOM-0001, tipo, `semana_inicio` (lunes), tasa Bs, estado BORRADOR/CERRADA/ANULADA, `version`, totales, quién cerró/anuló y motivo. Única por (tipo, semana) entre las no anuladas. |
| `nomina_lineas` | un renglón por trabajador: nombre (copia), moneda de pago, días, monto base, bruto, ref. Bs, bonificación, descuentos, total USD, total Bs. |
| `nomina_linea_cuotas` | cuotas de préstamo planeadas en cada renglón (se aplican al cerrar). |

Seguridad de BD: RLS activado y deny-all para anon/authenticated (acceso solo con service_role, patrón de
`migration_mesa_cambio.sql`); funciones con `search_path = ''` y execute solo para service_role.
Triggers: una nómina CERRADA solo admite el paso a ANULADA con motivo (nada más cambia); una ANULADA es inmutable; no se
borran nóminas cerradas/anuladas ni préstamos ni movimientos; los renglones y cuotas solo cambian mientras la nómina es
BORRADOR; el saldo de un préstamo solo cambia desde las funciones de cierre/anulación; un préstamo con cuotas
descontadas no se puede anular. Sin borrado físico de trabajadores (se desactivan).

Funciones atómicas (todas bloquean la fila y son seguras ante reintentos):
`nomina_guardar` (crea o reemplaza el borrador de (tipo, semana) con control de `version`), `nomina_cerrar` (descuenta
cuotas, baja saldos, pasa a CERRADA; si ya estaba cerrada devuelve `yaCerrada` sin tocar nada), `nomina_anular`
(si estaba cerrada, devuelve las cuotas al saldo con REVERSA).

## Estados

Nómina: BORRADOR -> CERRADA -> ANULADA (con motivo). BORRADOR -> ANULADA también es posible. Cerrada = inmutable.
Préstamo: ACTIVO -> PAGADO (saldo 0, automático) | ANULADO (con motivo, solo si no tiene cuotas descontadas).
Anular una nómina cerrada devuelve el saldo y un PAGADO vuelve a ACTIVO; luego se puede cargar otra para esa semana.

## Fórmulas (UN solo módulo: `backend/src/utils/nomina-calculo.ts`)

Copia espejo para la vista previa en pantalla: `shared/types/nomina-calculo.ts` (el alias @shared no resuelve en runtime
del backend; `backend/tests/nomina-calculo.test.ts` exige que ambas den lo mismo). El servidor siempre recalcula; nunca
confía en los totales que manda el navegador. Se rotulan en pantalla y se cambian solo en ese módulo.

- Monto base en divisas = pago por día en USD (ficha del trabajador, editable en la nómina de la semana).
- Total bruto USD = días trabajados x monto base.
- Tasa Bs = se escribe en la nómina (sugerencia: tasa BCV vigente; no obligatoria para guardar). Monto ref. en Bs =
  bruto USD x tasa.
- Descuentos = descuento por trabajo + cuotas de préstamo. Total trabajador (USD) = bruto + bonificación extra -
  descuentos. Total en Bs = total USD x tasa. Un total negativo se rechaza salvo confirmación explícita
  (`confirmarNegativos`) tras el aviso en pantalla.
- Cada renglón lleva una `moneda de pago` (USD o BS; sugerida: Binance = USD, pago móvil = BS, editable). Con eso:
  - Total a pagar en divisas = suma del total USD de los renglones en USD.
  - Total a pagar en Bs = suma del total Bs de los renglones en BS; su equivalente en USD = suma del total USD de esos
    mismos renglones (sin dividir de vuelta, para no arrastrar redondeo).
  - Total combinado en USD = divisas + equivalente de los Bs. Total combinado en Bs = Bs + (divisas x tasa).
- Totales por tipo (cada nómina) y general de la semana (suma de las nóminas de ambos tipos de esa semana).
- Dinero en centavos enteros (sin error de coma flotante). Días: 0 a 7, hasta 2 decimales.
- Cuota de préstamo sugerida = la cuota semanal del préstamo limitada a su saldo; el usuario puede cambiarla, nunca
  mayor al saldo. Se descuenta al CERRAR, no al guardar el borrador.

## Endpoints (`/api/nomina`)

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| GET `/trabajadores?tipo&incluirInactivos` | ver | lista |
| POST `/trabajadores` | crear | alta |
| GET `/trabajadores/:id` | ver | ficha |
| PATCH `/trabajadores/:id` | editar | edita (también reactiva con `activo: true`) |
| POST `/trabajadores/:id/desactivar` | eliminar | desactiva (soft-delete; no hay DELETE físico) |
| GET `/prestamos?trabajadorId&estado` | ver | lista con trabajador |
| POST `/prestamos` | crear | crea préstamo o adelanto |
| PATCH `/prestamos/:id` | editar | cuota semanal y nota |
| POST `/prestamos/:id/anular` | editar | anula con motivo |
| GET `/nominas?tipo&desde&hasta` | ver | historial |
| GET `/nominas/semana?tipo&semana` | ver | la nómina de esa semana (o null) + candidatos (trabajadores activos con su pago diario y préstamos con saldo) |
| GET `/nominas/:id` | ver | detalle |
| POST `/nominas` | crear | crea o edita el borrador de (tipo, semana) |
| POST `/nominas/:id/cerrar` | editar | cierra y descuenta cuotas |
| POST `/nominas/:id/anular` | eliminar | anula con motivo |
| GET `/categoria-pago?tipo` | ver | categoría del Wallet que llevará el egreso del pago (fase 2) |
| POST `/nominas/:id/pagar` | editar + cochinito.crear + acceso a la cuenta | paga la nómina cerrada desde el Wallet (fase 2) |

Mientras las tablas no existan, todas responden 503 con el mensaje de migración pendiente
(`utils/migracion-pendiente.ts`).

## Pantallas (frontend/src/features/nomina, ruta `/nomina`)

Pestañas: Personal administrativo, Personal operativo (lista + alta/edición de trabajadores), Nómina semanal (selector de
tipo y semana, tabla editable con los totales y el rótulo de la fórmula, guardar borrador, cerrar, anular, imprimir/PDF
con `services/pdf-documento`), Préstamos y adelantos (crear, ver saldo, anular).

## Reglas de validación (revisión de seguridad)

- **Totales negativos**: se pueden guardar SOLO como borrador (el usuario confirma con `confirmarNegativos`); una nómina
  con algún renglón de total negativo NO se puede cerrar (`cerrarNomina` lo comprueba antes y `nomina_cerrar` lo vuelve a
  comprobar en la BD). El botón «Cerrar nómina» se deshabilita mientras haya negativos.
- **Préstamo vs lo ganado**: la suma de cuotas de préstamo de un renglón no puede superar lo ganado (días x monto base +
  bonificación). Se valida en el cálculo (`prestamoExcedeGanado`, backend y espejo compartido), en zod, en `nomina_guardar`
  y con un CHECK en `nomina_lineas`.
- **Cédula**: se guarda normalizada (mayúsculas, sin puntos, guiones ni espacios) y el índice único la compara igual, así
  «V-12.345.678» y «V12345678» son la misma persona.
- **Trabajadores**: `nomina_guardar` rechaza inactivos; el `tipo` de un trabajador que ya aparece en una nómina no se puede
  cambiar (trigger): se desactiva y se registra otro.
- **Tamaño del cuerpo**: `/api/nomina` acepta hasta 1 mb (el resto del API, 100 kb); el parser grande se monta dentro del
  router, después de autenticar.

## Fase 2: pagar la nómina desde el Wallet

Pedido: «configurar el apartado de nómina con las categorías de gastos financieros (nómina personal administrativo y
personal operativo)». Decisión de Julio: «etiquetar y pagar desde Wallet». Desde una nómina CERRADA se crea el egreso en
el Wallet desde la cuenta que se elija, con la categoría del tipo de personal. Migración: `docs/migration_nomina_pago_wallet.sql`
(rollback `_ROLLBACK.sql`; sin aplicar). Requiere `migration_categorias_uso.sql` solo para que el egreso lleve categoría
(sin ella, o sin categoría asignada, el egreso se crea sin categoría y la pantalla lo avisa antes de pagar).

**Acción separada, no bloquea el cierre.** Cerrar sigue siendo solo cálculo y descuento de cuotas. «Pagar desde Wallet» es un
botón de la nómina cerrada (y sin pagar) que abre un modal: por cada moneda con montos (divisas y/o bolívares) se elige una
cuenta de esa moneda (selector con imagen/color y saldo), más fecha y referencia opcional; en cuentas Bs se responde Sí/No a la
comisión bancaria. El resumen muestra los montos (Bs con su equivalente en USD) y pide confirmación.

**Qué se crea.** Un egreso por moneda: divisas = suma del total USD de los renglones en USD, en una cuenta USD; bolívares = suma
del total Bs de los renglones en BS, en una cuenta VES. Los montos los calcula la BD de los renglones; el navegador nunca los
manda. Descripción: «Nómina NOM-000X · Personal operativo · semana del 05/10/2026 · divisas» (ningún dato personal; el aviso a
Telegram de `/api/nomina` sigue siendo «ignorable» y el egreso no pasa por `POST /cochinito/movimientos`, así que no genera aviso
propio). La categoría sale de `categorias_uso` (usos `nomina_administrativo` / `nomina_operativo`) vía `categoriasDeUso` en el
backend, que solo ofrece una que acepte egresos; la BD la valida con el trigger `movimientos_validar_categoria`.

**Una sola función SQL atómica: `nomina_pagar(nomina, datos, usuario)`** (search_path vacío, execute solo service_role, patrón
de `nomina_cerrar`). Bloquea la fila de la nómina, exige CERRADA, y si ya hay pago devuelve `yaPagada: true` sin tocar nada
(idempotente; el segundo pago o el reintento no mueve saldos). Exige exactamente una cuenta por moneda con montos, cuenta
vigente y de la moneda correcta, fecha no anterior a la semana, y saldo suficiente. Reutiliza lo que ya hay, sin duplicar reglas:
- Cuenta VES con comisión «Sí»: llama a la RPC existente `crear_movimiento_con_comision_bancaria` (0.3 %, mínimo 14 Bs; el cargo
  nace en la misma transacción y valida saldo para monto + comisión). Sí/No es obligatorio si la migración de comisión está
  aplicada, igual que en un egreso manual; «No» queda auditado (`sin_comision_bancaria`, constancia por el mismo mecanismo que el
  Wallet manual; si no se puede auditar el pago ya existe y se devuelve una advertencia).
- Sin comisión: inserta el egreso como el Wallet manual (`subtipo` y `grupo_id` nulos); los triggers existentes ajustan el saldo
  de la cuenta y le dan su correlativo MV-.
- El vínculo queda en `nomina_pagos` (nómina, moneda, cuenta, movimiento, monto, equivalente USD, cantidad de trabajadores,
  fecha, referencia, quién). `unique (nomina_id, moneda_pago)` y `unique (movimiento_id)`: nunca dos pagos de la misma moneda. La
  tabla es inmutable (trigger) y con RLS deny-all.

**Permisos.** `POST /api/nomina/nominas/:id/pagar` exige `nomina.editar` + `cochinito.crear` + acceso de edición a cada cuenta
(`exigirAccesoBancas`, que lee `bancas[].bancaId` del cuerpo). `GET /api/nomina/categoria-pago?tipo=` (nomina.ver) informa la
categoría que llevará el egreso. En pantalla el botón solo aparece con ambos permisos y el selector solo ofrece cuentas editables.

**Anular una nómina pagada: se anula también el pago (decisión).** `nomina_anular` se reemplaza (misma firma) y, dentro de la misma
transacción que devuelve las cuotas de préstamo, anula los egresos del pago con las funciones del Wallet
(`anular_movimiento_banca`, o `anular_movimiento_con_comision_bancaria` si lleva comisión, que anula el cargo junto al principal).
Los saldos de las cuentas vuelven exactamente a lo que eran; cualquier fallo revierte todo. Se prefirió esto a «exigir anular el
pago primero» porque son dos pasos que dejarían una nómina anulada con dinero fuera, y porque anular ya exige el permiso
`nomina.eliminar` y un motivo (que viaja al motivo de los movimientos). A cambio, un guardián sobre `movimientos`
(`movimientos_nomina_proteger`, mismo patrón que la comisión y la mesa de cambio) impide anular o cambiar monto, moneda o cuentas de
un egreso de nómina (o de su cargo de comisión) desde el Wallet: solo se anula anulando la nómina. Concepto, referencia, fecha y
comprobantes siguen editables, y la categoría también se puede cambiar. Para corregir un pago hecho desde la cuenta equivocada hay
que anular la nómina y cargar otra (no hay «anular solo el pago»; queda como mejora si Julio lo pide).

**Pantalla y PDF.** La nómina muestra «Pagada desde X el fecha» con una línea por moneda (monto, cuenta, MV- y enlace al
movimiento); si la nómina se anuló, «el pago se anuló junto con la nómina». El PDF añade una fila «Pagada» por moneda (cuenta, monto
y fecha, sin datos personales). `GET /nominas/:id` incluye `pagos`; si la migración no está aplicada la lista viene vacía y todo
funciona como en la fase 1 (el pago responde 503 con el nombre de la migración).

**Ensayo.** El SQL se probó de punta a punta en una transacción con rollback (nómina de prueba, cierre, pago en USD y Bs con
comisión, categoría aplicada, segundo pago devuelto como `yaPagada`, intentos de anular/cambiar desde el Wallet rechazados,
anulación de la nómina y saldos idénticos al inicio), más los rechazos (moneda equivocada, moneda de sobra, fecha anterior, saldo
insuficiente, borrador, comisión sin responder, categoría de ingreso).
