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
| `nomina_trabajadores` | tipo (ADMINISTRATIVO/OPERATIVO), nombres, apellidos, cédula (única), RIF, teléfono, dirección, contacto de emergencia (nombre, teléfono), pago móvil (banco, teléfono, cédula), Binance (correo/ID), `pago_diario_usd` (sueldo diario en divisas), `pago_diario_bs` (sueldo diario en Bs, fase 3), `activo` (soft-delete). |
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

- **Vigente desde la fase 3 (dos sueldos): ver «Fase 3» al final.** Lo que sigue describe la fase 1 (un solo sueldo y una moneda
  de pago por renglón) y se conserva solo como historia: bruto = días x sueldo; total = bruto + bonificación - descuentos; Bs = USD x tasa.
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
| GET `/trabajadores/:id/cargo` | ver | últimos movimientos del trabajador, los de Bs con su equivalente en USD a la tasa Binance congelada (fase 3) |

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

## Fase 3: dos sueldos por trabajador y cargo del trabajador

Pedido de Julio: en los datos del trabajador, «2 espacios de sueldo»: 1 sueldo en DIVISAS (se paga en efectivo o Binance) y 2 sueldo
en BS (la otra parte del sueldo, pagada en bolívares); y un apartado «cargo del trabajador» con sus movimientos, donde todo
movimiento en Bs muestre su equivalente en $ a la tasa Binance del mediodía del día del pago. Migración:
`docs/migration_nomina_dos_sueldos_cargo.sql` (rollback `_ROLLBACK.sql`; sin aplicar, ensayada en transacción con rollback).

### Dos sueldos

- **Unidad**: por día, como antes. El sueldo en divisas es USD (`nomina_trabajadores.pago_diario_usd`, la columna no se renombra) y
  el sueldo en Bs se guarda EN Bs (`pago_diario_bs`): así la parte en bolívares no cambia aunque cambie la tasa; su equivalente en USD
  sale de la tasa de la nómina.
- **El renglón** lleva `monto_base_usd` y `monto_base_bs` (editables cada semana, se proponen de la ficha) y dos partes a pagar:
  `pagar_usd` (divisas) y `pagar_bs` (Bs). `moneda_pago` pasa a ser un dato deducido: `USD`, `BS` o `MIXTO` (las dos partes). Ya no se
  elige moneda por renglón.
- **Fórmulas** (siguen en UN solo módulo, `backend/src/utils/nomina-calculo.ts`, y su espejo; la explicación completa está en su cabecera):
  - bruto divisas = días x sueldo en divisas; bruto Bs = días x sueldo en Bs; total bruto USD = bruto divisas + bruto Bs / tasa.
  - **Bonificación extra**: siempre en divisas.
  - **Descuentos y cuotas de préstamo**: se cargan PRIMERO a la parte en divisas. Si el trabajador tiene sueldo en Bs y las divisas no
    alcanzan, el sobrante (en USD) se descuenta de los Bs a la tasa de la nómina; así quien cobra solo en Bs también puede tener
    cuotas (que son en USD). Sin sueldo en Bs no hay a dónde cargar el sobrante: el total sale negativo, con el mismo aviso de antes
    y sin poder cerrar.
  - a pagar en divisas = bruto divisas + bonificación - descuentos cargados a divisas; a pagar en Bs = bruto Bs - sobrante x tasa;
    total del trabajador USD = a pagar en divisas + a pagar en Bs / tasa.
  - Tope del préstamo: las cuotas no pueden superar lo ganado, que ahora incluye los Bs a la tasa (zod, servidor, `nomina_guardar` y el CHECK).
  - **Tasa**: obligatoria cuando algún trabajador tiene sueldo en Bs (el servidor responde 400, `nomina_guardar` y `nomina_cerrar` lo
    vuelven a exigir). Sin sueldo en Bs sigue siendo opcional.
  - Totales: divisas = suma de `pagar_usd`; Bs = suma de `pagar_bs`; equivalente = suma de los equivalentes de cada renglón;
    combinado USD = divisas + equivalente; combinado Bs = Bs + divisas x tasa. `cantidadDivisas` y `cantidadBs` cuentan trabajadores
    con algo que cobrar en cada moneda (uno con las dos partes cuenta en ambos); `nominas.cantidad_trabajadores` guarda las personas.
- **Pagar desde el Wallet** (`nomina_pagar` reemplazada, misma firma): toma lo que se paga en cada moneda de `pagar_usd` / `pagar_bs`,
  así que un renglón con las dos partes alimenta tanto el egreso en USD como el egreso en Bs. El equivalente en USD de los Bs
  (`nomina_pagos.monto_usd`) es la suma de `total_usd - pagar_usd` de los renglones. Todo lo demás (cuentas, saldo, comisión, idempotencia,
  anulación junto con la nómina) no cambia.
- **Datos existentes**: `pago_diario_usd` queda como sueldo en divisas, salvo un trabajador cuyo último renglón en una nómina CERRADA
  (los borradores no cuentan) se pagó en Bs con tasa: su sueldo pasa a Bs (`pago_diario_usd x tasa` de esa nómina) y el de divisas queda
  en 0. Antes de convertir se guarda el original en `nomina_trabajadores_bak_dos_sueldos` (RLS deny-all; el ROLLBACK lo restaura exacto).
  Los renglones anteriores conservan sus montos: `pagar_usd`/`pagar_bs` se rellenan según su moneda de pago (se desactiva un instante el
  trigger que protege renglones cerrados, solo para rellenar columnas nuevas). Los renglones en Bs de una nómina en BORRADOR (con tasa)
  se convierten además a la parte en Bs (`monto_base_bs = sueldo USD x tasa`, `monto_base_usd = 0`, `bruto_bs`), con respaldo en
  `nomina_lineas_bak_dos_sueldos`: al reabrirlos y guardarlos siguen pagándose en bolívares (una bonificación del renglón pasa a pagarse
  en divisas, como en todo el módulo). Producción hoy: 0 nóminas, 6 trabajadores (3 en cada tipo): todos quedan con su sueldo en divisas
  y 0 en Bs.
- **Orden de despliegue: la migración PRIMERO, luego el código.** Las lecturas del backend piden columnas explícitas (`pago_diario_bs`,
  `pagar_usd`, `pagar_bs`, `tasa_binance`...) y no usan `select *`: con el código nuevo y sin la migración fallan con «columna
  inexistente». Un frontend viejo todavía abierto envía `monedaPago` en cada renglón: el servidor lo rechaza (400, «Recarga la página:
  la nómina cambió») en vez de guardarlo en silencio. `nomina_guardar` en SQL sí sigue aceptando el cuerpo anterior (una moneda por
  renglón), pero el backend nuevo ya no lo manda.
- **Pantallas**: ficha del trabajador con los dos campos; editor con columnas de sueldo en divisas y en Bs, «a pagar en divisas», «a pagar
  en Bs» (con su equivalente) y total del trabajador; totales y PDF con las dos partes.

### Cargo del trabajador

- **Dónde**: botón «Ver cargo» en la ficha del trabajador (Personal administrativo / operativo). `GET /api/nomina/trabajadores/:id/cargo`
  (permiso `nomina.ver`). Lista los últimos 100 movimientos, del más reciente al más antiguo: pagos de nómina en divisas y en Bs
  (de nóminas cerradas; pendientes de pago, pagadas o anuladas), préstamos y adelantos, cuotas y reversas, más el saldo pendiente de
  préstamos. Solo lectura; sin datos personales en los textos.
- **Qué tasas guarda el sistema hoy**: `tasas_cambio` (moneda_origen, moneda_destino, tasa, fuente BCV / Binance, fecha de captura). La
  llena el backend de forma perezosa cuando alguien consulta `/api/tasas/{oficial,euro,binance}` y su caché venció (Binance: 15 min); no hay
  cron, ni n8n, ni función SQL que la llene (la instancia n8n evo-n8n-pronoia no tiene ningún workflow de tasas). Binance tiene entonces
  capturas irregulares (96 desde el 14/08; dependen de que alguien abra Wallet). `cambista_asientos.tasa` es la tasa de cada operación de la
  Mesa de cambio (no se usa aquí). No se tocó el mecanismo que llena `tasas_cambio`.
- **Almacenamiento mínimo**: se reutiliza `tasas_cambio`; no hay tabla nueva. La función `tasa_binance_del_dia(fecha)` devuelve la captura
  Binance más reciente que no pase de las 12:00 de Caracas de esa fecha (máximo 3 días de antigüedad). Si ese día hubo captura antes del
  mediodía es la del día; si no, la anterior más cercana, y la hora de captura queda guardada para decir cuál se usó. Sin captura en esa
  ventana, el pago se registra sin equivalente y el cargo lo dice («Sin tasa Binance registrada para ese día»); nunca se inventa.
- **Qué día cuenta**: `nomina_pagar` calcula el equivalente con el día REAL del registro (hoy en Caracas, `now()`), NO con la fecha que
  elige quien paga: así nadie puede escoger una fecha para fijar una tasa conveniente. La fecha elegida solo fecha el egreso
  (`nomina_pagos.fecha`); `nomina_pagos.registrado_en` guarda el instante real. Si ambas difieren, el backend deja una entrada de
  auditoría (`fecha_pago_distinta`, entidad `movimiento_banca`) por cada egreso del pago.
- **Parte en Bs diminuta**: si el equivalente en USD de la parte en Bs redondea a 0.00 (`nomina_pagos.monto_usd` exige > 0), `nomina_pagar`
  responde «La parte en Bs es demasiado pequeña para pagarla.» (409) en vez de fallar por el constraint.
- **Congelado**: dentro de `nomina_pagar`, al crear el pago en Bs se guardan en `nomina_pagos` la tasa (`tasa_binance`), su captura
  (`tasa_binance_capturada`) y el equivalente del pago (`equivalente_binance_usd = monto en Bs / tasa`). La tabla es inmutable (trigger) y un
  CHECK exige que los tres vayan juntos y solo en pagos en Bs. El cargo de cada trabajador calcula `Bs de su renglón / tasa congelada` al
  centavo (la suma de varios trabajadores puede diferir en centavos del equivalente del pago completo). Anular la nómina conserva la tasa
  congelada del pago, pero el cargo marca el movimiento como anulado y sin equivalente.
- **Los movimientos en Bs** son los pagos de nómina en Bs (préstamos, adelantos y cuotas son en USD). También se ve el equivalente en la línea
  de pago de la nómina y en su PDF.

### Supuestos a confirmar con Julio

1. El sueldo en Bs es un monto fijo en Bs por día (no un monto en USD que se convierte).
2. «Cargo del trabajador» = historial de movimientos de nómina del trabajador, no una cuenta corriente con saldo en Bs.
3. «12 del día» = mediodía hora de Caracas del día en que se REGISTRA el pago (hoy), no de la fecha que elige quien paga.
4. La bonificación extra es siempre en divisas; los descuentos van primero a divisas y el sobrante a Bs.
5. Máximo 3 días de antigüedad para la tasa Binance del día; más allá, el pago queda sin equivalente.
6. Un trabajador migrado por «último renglón en Bs» se convierte a la tasa de esa nómina (hoy no aplica a nadie).
