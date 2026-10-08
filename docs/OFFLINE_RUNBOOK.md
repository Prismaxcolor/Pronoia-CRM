# Runbook del modo sin conexion (Pronoia PWA)

Documento operativo para soporte, despliegue y reversion. Estado: primera version (Fase 6).
Las partes marcadas con **(verificar)** dependen de pantallas que otras fases aun estan terminando;
confirmarlas en la segunda pasada de pruebas.

Archivos relacionados:

- Pruebas e2e: `frontend/e2e/` (se ejecutan con `npm run test:e2e` dentro de `frontend/`).
- Conciliacion SQL (solo lectura): `docs/sql/conciliacion_operaciones_cliente.sql`.
- Migracion de idempotencia: `docs/migration_operaciones_cliente.sql`.

---

## 1. Arquitectura en una pagina

```
 Telefono (PWA, React)                                    Servidor (Express)            Supabase
 +---------------------------------------------+          +----------------------+      +--------------+
 | Service worker (Workbox): shell precacheado |          | requireAuth (JWT)    |      | tickets_*    |
 |   -> la app abre sin red                    |          | idempotencia-service |----->| operaciones_ |
 | Sesion local  (IDB 'pronoia-offline-sesion')|          |  reclamar_operacion_ |      |   cliente    |
 |   token + usuario + permisos + PIN (hash)   |          |  cliente() (atomica) |      +--------------+
 | Catalogos     (IDB 'pronoia-offline'/       |          | GET /api/auth/       |
 |   'catalogos'): productos, proveedores...   |          |   offline-config     |<-- configuracion_secreta
 | Cola          (IDB 'pronoia-offline'/'cola')|          |   (OFFLINE_ACTIVO)   |    OFFLINE_ACTIVO
 |   + fotos     (almacen de imagenes en IDB)  |          +----------------------+
 | Borradores    (localStorage 'pronoia:       |
 |   borrador:*' + fotos en IDB)               |
 | Motor de cola: 1 ejecutor por navegador     |
 |   (Web Locks) + BroadcastChannel entre tabs |
 +---------------------------------------------+
```

Piezas y responsabilidades:

| Pieza | Que hace | Donde |
|---|---|---|
| Conexion | Eventos online/offline + sonda `HEAD /health` + resultado de cada fetch. Barra "Sin conexion". | `lib/offline/conexion*.ts`, `components/EstadoConexion.tsx` |
| Sesion local / PIN | Guarda la sesion para abrir sin red; PIN opcional (bloqueo tras intentos fallidos). Con 401 real y con red, la sesion SI se cierra. | `lib/offline/sesion*.ts`, `PantallaDesbloqueoPin.tsx` |
| Catalogos | Copia de productos, proveedores, clientes, taras, almacenes, lotes... para los formularios. | `lib/offline/catalogos*.ts` |
| Cola | Cada operacion (pesaje, traslado, toma fisica, alta...) se guarda con un `id` UUID que se envia como `clientRequestId`. Estados: `pendiente`, `rechazada`, `ilegible`. Reintento con retroceso 5 s a 5 min. | `lib/offline/cola*.ts` |
| Idempotencia | El servidor registra cada `clientRequestId` en `operaciones_cliente`; un reintento devuelve el resultado guardado y NO crea otro registro. | `backend/src/services/idempotencia-service.ts` |
| Lecturas | Pantallas de dinero/stock se muestran desde cache con "Sin conexion - datos de hace X" y con las escrituras deshabilitadas. | `lib/offline/lectura*.ts`, `BannerSinConexion.tsx` |
| Interruptor | `OFFLINE_ACTIVO` en `configuracion_secreta`, consultado por `GET /api/auth/offline-config`. | `backend/src/services/offline-config-service.ts` |

Reglas de seguridad de datos:

1. Una operacion encolada NUNCA se borra sola. Solo sale de la cola al recibir 2xx o por accion humana ("descartar").
2. Un rechazo definitivo (4xx de negocio, p. ej. 409 de stock) pasa a `rechazada` conservando payload y fotos.
3. 401 pausa la cola (no la marca rechazada) hasta renovar la sesion.
4. Cerrar sesion no borra la cola; pide confirmacion y ofrece exportar respaldo.
5. Una operacion solo se envia con la sesion del usuario que la creo.

---

## 2. Matriz: que funciona sin red

Leyenda: SI = completo; COLA = se guarda y se envia al volver la red; LECTURA = se ve la ultima copia (con antiguedad), no se escribe; NO = requiere conexion (la pantalla lo dice).

| Funcion | Sin red | Notas |
|---|---|---|
| Abrir la app con sesion iniciada | SI | Requiere haber abierto la app con red al menos una vez (service worker + sesion). |
| Desbloqueo con PIN | SI | Solo si el usuario activo el PIN (con red). |
| Iniciar sesion por primera vez | NO | Necesita servidor. |
| Cerrar sesion y volver a entrar sin red | NO | Avisar: tras cerrar sesion sin red no se puede volver a entrar hasta tener internet. |
| Navegar entre pantallas ya visitadas | SI | La app es un shell cacheado. |
| Formularios (proveedor, producto, material, tara, lote, almacen) | SI | Catalogos desde IndexedDB. |
| Pesaje de compra / venta con fotos | COLA | Codigo provisional `PEND-n` hasta que el servidor asigne el definitivo. |
| Pesaje en bruto y completar despues | COLA | La operacion "completar" depende de la creacion y se envia despues de ella. |
| Traslados entre almacenes | COLA | |
| Toma fisica (conteos) | COLA (F4) | **(verificar)** |
| Altas de maestros (proveedor, cliente, producto) con dependientes | COLA (F4) | Se envian en orden de dependencia. **(verificar)** |
| Transformaciones, packing list | COLA (F4) | **(verificar)** |
| Inventario, almacenes, estados de cuenta, cochinito (bancas y movimientos) | LECTURA (F5) | Muestra la antiguedad; botones de escritura deshabilitados. **(verificar)** |
| Facturacion, pagos, cruces, notas de ajuste | NO / LECTURA | El dinero no se escribe sin red. |
| Asistente, portal de proveedores, llaves de edicion, Telegram, usuarios, auditoria | NO | Pantalla "requiere conexion". |
| Editar / anular un ticket ya enviado | NO | Requiere servidor (llaves de edicion). |
| Aviso de nueva version | SI | Nunca recarga con formularios con cambios; la cola y los borradores sobreviven a la recarga. |

---

## 3. Procedimiento de soporte

### 3.1 "Se me perdio un pesaje"

Regla: **no pedir que reescriba nada hasta terminar este procedimiento.** Casi siempre el pesaje existe: esta en la cola del telefono, en el servidor, o en un borrador.

1. **Datos de partida**: usuario (correo), aproximadamente cuando lo hizo, proveedor/cliente, peso, y si el telefono estaba sin red.
2. **Pedirle que abra la app en el MISMO telefono y navegador** (no otro, no ventana privada). Pantalla de la cola / indicador de pendientes **(verificar nombre de la pantalla)**:
   - Si ve el pesaje como `PEND-n` pendiente: tiene red? Tocar "Reintentar". Si sigue pendiente, ir al paso 4.
   - Si esta en **rechazadas**: leer el motivo (p. ej. "Stock insuficiente"), corregir y reenviar, o descartar a conciencia. Los datos y fotos siguen guardados.
   - Si no aparece: seguir.
3. **Buscar en el servidor** (seccion 4): operaciones del usuario en la ventana de tiempo. Casos:
   - `estado = ok` y existe el ticket: el pesaje ya llego; seguramente solo no refresco la lista. Verificar el codigo definitivo y avisar al usuario.
   - `estado = error`: el servidor lo rechazo; ver la columna `error`.
   - `estado = procesando` con mas de 5 minutos: intento que murio a mitad; el telefono lo reintentara cuando tenga red.
   - Sin fila: la operacion nunca llego al servidor. Sigue en el telefono (paso 4) o se perdio antes de encolar (paso 5).
4. **Rescatar la cola del telefono** (seccion 3.2). Es el respaldo definitivo: contiene operaciones y fotos.
5. **Borradores**: si el usuario no llego a pulsar "Generar", el formulario puede estar como borrador (persiste hasta 24 h; las fotos tambien). Abrir Pesaje en el mismo telefono: debe aparecer el aviso de borrador restaurado.
6. Si despues de 1-5 no hay rastro: revisar si hubo cierre de sesion con "Salir y borrar borradores", cambio de telefono o limpieza de datos del navegador. Documentar el caso (usuario, hora, dispositivo) para mejorar el procedimiento.

Nunca: pedir "borrar datos del sitio / desinstalar la app" antes de exportar la cola; eso destruye la cola.

### 3.2 Exportar la cola del telefono de un usuario

1. Con el usuario en su telefono: menu lateral > **Cerrar sesion**. Si hay pendientes aparece "Antes de cerrar sesion" con el boton **Exportar respaldo**. Genera `respaldo-pronoia-AAAAMMDD-HHMM.json` (operaciones + fotos en base64).
2. En Android el archivo queda en Descargas; que lo envie por WhatsApp/correo a soporte.
3. Tocar **Cancelar** si no quiere cerrar sesion (el respaldo ya se descargo). **(verificar)**: la pantalla de la cola tambien debe ofrecer exportar sin pasar por cerrar sesion.
4. Para **importar** en otro telefono o tras reinstalar: pantalla de la cola > **Importar respaldo** **(verificar)**. Importar nunca pisa una operacion con el mismo id ni borra nada; importar dos veces el mismo archivo no duplica. El envio sigue siendo idempotente: aunque la operacion ya hubiera llegado, el servidor no crea otra.
5. Inspeccion manual del JSON: `formato = "pronoia-cola"`, `version = 1`, `operaciones[]` (cada una con `id`, `tipo`, `endpoint`, `payload`, `estado`, `capturadoEn`, `codigoProvisional`, `rechazo`). El `id` es el `client_request_id` para conciliar.

### 3.3 Conciliar con `operaciones_cliente`

Todas las consultas estan en `docs/sql/conciliacion_operaciones_cliente.sql` (solo lectura). Supabase Studio > SQL Editor.

| Consulta | Para que | Resultado esperado |
|---|---|---|
| 0 | Confirmar que la migracion esta aplicada | 4 filas con `existe = true` |
| 1 / 1b | Operaciones recibidas por dia/tipo/estado; detalle por usuario | Mayoria `ok`; `retraso_*` = tiempo entre captura en el telefono y llegada |
| 2a | Duplicados por `client_request_id` | **0 filas** (si hay filas: incidente, ver 6) |
| 2b | Posibles duplicados de negocio (mismo proveedor, peso y fecha en < 10 min) | Revisar a mano; pueden ser legitimos |
| 3 | Operaciones en `error` o `procesando` > 5 min | Pocas; cada `error` tiene explicacion de negocio |
| 4a | `ok` cuya entidad ya no existe | Solo si alguien elimino el ticket a proposito |
| 4b | Tickets con `client_request_id` sin operacion registrada | 0 o explicables (migracion aplicada tarde) |
| 4c | Operacion no `ok` pero con ticket creado | El reintento la cierra; si no, revisar |
| 5 | Una operacion concreta por `client_request_id` | Cruza operacion + ticket/traslado |

Para conciliar un respaldo exportado: tomar los `id` del JSON y pegarlos en la consulta 5 (uno por uno) o con `where client_request_id in (...)`.

### 3.4 Apagar el modo sin conexion (`OFFLINE_ACTIVO`)

El interruptor vive en la tabla `configuracion_secreta` (clave `OFFLINE_ACTIVO`). Valores:

| Valor | Efecto |
|---|---|
| (sin fila) o `todos` | Activo para todos |
| `ninguno` (tambien `false`, `0`, `no`, `off`) | Apagado para todos |
| lista de ids de usuario separados por coma, `;` o espacio | Activo solo para esos usuarios |

Cambiarlo (Supabase Studio > SQL Editor; es una escritura de configuracion, no de datos de negocio):

```sql
insert into public.configuracion_secreta (clave, valor)
values ('OFFLINE_ACTIVO', 'ninguno')
on conflict (clave) do update set valor = excluded.valor;
```

Detalles importantes:

- El backend cachea los secretos unos minutos (`TTL_SECRETOS_MS`), asi que el cambio tarda un poco en verse. Una variable de entorno `OFFLINE_ACTIVO` en el servidor tiene prioridad sobre la tabla.
- El telefono consulta `GET /api/auth/offline-config` con red y recuerda el ultimo valor. Un telefono que esta sin red seguira con el valor anterior hasta reconectar.
- Apagar NO borra lo que ya hay en la cola: las operaciones pendientes se siguen enviando al reconectar **(verificar con F3: confirmar que con el interruptor apagado el motor aun vacia la cola)**. Si un telefono tiene pendientes, pedir que reconecte y espere a que la cola quede en 0 antes de dar por cerrado el apagado.
- Apagar es la primera medida ante un incidente (ver 6); no requiere despliegue.

---

## 4. Plan de despliegue gradual (por usuario)

Prerrequisitos (una sola vez, en orden):

1. Aplicar `docs/migration_operaciones_cliente.sql` en Supabase (aditiva, idempotente, tiene ROLLBACK al final). Verificar con la consulta 0 de la conciliacion. Hasta que se aplique, el backend ejecuta las operaciones SIN idempotencia: **no activar el modo sin conexion para nadie antes de este paso.**
2. Desplegar backend (idempotencia + `/api/auth/offline-config`).
3. Poner `OFFLINE_ACTIVO = 'ninguno'` ANTES de desplegar el frontend, de modo que nadie lo tenga activo al llegar el codigo.
4. Desplegar frontend. Confirmar que los usuarios siguen trabajando igual (el modo esta apagado).

Olas (cada ola: activar, observar un dia laboral completo, conciliar, decidir):

| Ola | Quien | Valor de `OFFLINE_ACTIVO` | Criterio para avanzar |
|---|---|---|---|
| 0 | Equipo de desarrollo (1-2 telefonos de prueba) | ids del equipo | Lista de verificacion de la seccion 7 completa en Android real |
| 1 | 1 trabajador de bascula de confianza | su id | 1 dia: consultas 2a = 0 filas, 3 sin `procesando` atascados, 0 incidencias de "se perdio un pesaje" |
| 2 | Todos los trabajadores de pesaje | ids de los trabajadores | 3 dias iguales; revisar rechazadas (motivos coherentes) |
| 3 | Administracion y resto | `todos` (o borrar la fila) | 1 semana estable |

Ejemplo de ola 1: `update public.configuracion_secreta set valor = '<uuid-del-trabajador>' where clave = 'OFFLINE_ACTIVO';`

Monitoreo diario durante el despliegue: consultas 1, 2a, 3 y 4b del archivo de conciliacion; preguntar a los usuarios piloto cuantos pendientes quedaron al final del dia.

Comunicacion a los usuarios piloto (antes de activar): abrir la app con red al menos una vez al dia; activar el PIN si el telefono es compartido; no cerrar sesion con pendientes; no borrar datos del navegador.

---

## 5. Plan de reversion

Escalera de menor a mayor impacto. Parar en el primer escalon que resuelva el problema.

| Nivel | Accion | Cuando | Efecto / riesgo |
|---|---|---|---|
| 1 | `OFFLINE_ACTIVO = 'ninguno'` (o quitar de la lista al usuario afectado) | Cualquier sospecha de duplicados, perdida o comportamiento raro | Inmediato (tras el cache de secretos). No toca datos. Las colas existentes se vacian al reconectar (verificar). |
| 2 | Revertir el frontend en Vercel a un deploy anterior (Deployments > Promote/Rollback) | El frontend nuevo rompe pantallas aun con el modo apagado | Los telefonos reciben el aviso "Nueva version" y actualizan. Colas y borradores sobreviven (IndexedDB/localStorage). Un formato de cola mas nuevo que el conocido queda `ilegible`: se conserva intacto, no se envia ni se borra. |
| 3 | Revertir el backend al deploy anterior | El backend nuevo falla | Los esquemas zod ignoran campos desconocidos (no usan `.strict()`), asi que un backend viejo recibe `clientRequestId` sin error, pero **sin idempotencia**: un reintento tras respuesta perdida puede duplicar. Hacerlo solo con el modo apagado (nivel 1) y colas vacias. |
| 4 | Rollback SQL (ultimo comentario de `migration_operaciones_cliente.sql`) | Casi nunca. Solo si la migracion misma causa problemas | Borra la tabla de idempotencia: **se pierde la proteccion contra duplicados**; hacerlo solo con el modo apagado para todos y las colas vacias. |

Despues de cualquier reversion: correr la conciliacion (consultas 2a, 3, 4a-c), recoger los respaldos de los telefonos con pendientes (3.2) y escribir el incidente.

---

## 6. Incidentes tipicos

| Sintoma | Causa probable | Accion |
|---|---|---|
| Ticket duplicado | Consulta 2a > 0 filas: falta el indice unico (migracion a medias) o un usuario capturo dos veces a mano (2b) | Nivel 1 de reversion; corregir indice; anular el duplicado por el flujo normal de anulacion |
| Operaciones `procesando` > 5 min | El servidor cayo a mitad | El telefono reintenta solo; si el telefono ya no reintenta, revisar 4c |
| Muchas rechazadas con el mismo motivo | Regla de negocio (stock, tara vencida, producto inactivo) cambio mientras el telefono estaba sin red | Revisar motivos (consulta 3, resumen); contactar usuarios; no reenviar a ciegas |
| "La app pide PIN y se me olvido" | PIN local olvidado | "Olvide mi PIN / Cerrar sesion": la cola se conserva; volver a entrar con red |
| App en blanco / "No se pudo cargar esta pantalla" tras deploy | HTML cacheado apunta a archivos que ya no existen | Recargar con red; los datos no se pierden |

---

## 7. Lista de verificacion en un Android real, modo avion

Equipo: telefono Android con Chrome actualizado, la app instalada como PWA ("Instalar app") o abierta en Chrome. Usuario de prueba con permiso de pesaje. Ambiente de **pruebas/preproduccion** o produccion con el interruptor en lista solo con ese usuario. No usar datos reales de clientes.

Anotar al lado de cada paso: OK / FALLO y observaciones.

**A. Preparacion (con red)**

1. [ ] Abrir la app, iniciar sesion con el usuario de prueba, marcar "Recordarme".
2. [ ] Abrir **Pesaje**. Esperar 10 s (precarga de catalogos). Abrir **Productos** y **Proveedores** una vez.
3. [ ] Menu lateral > **PIN sin conexion** > **Activar** > poner un PIN de 4 a 8 digitos y guardarlo.
4. [ ] Cerrar la app por completo (deslizar fuera de recientes) y volver a abrirla con red: debe entrar sin pedir login.
5. [ ] Anotar la hora y el contador de pendientes (debe ser 0).

**B. Abrir sin red**

6. [ ] Activar **modo avion** (wifi y datos apagados). Cerrar la app y abrirla de nuevo.
7. [ ] Pide el **PIN**. Escribir uno incorrecto: mensaje "PIN incorrecto" con intentos restantes. Escribir el correcto: entra.
8. [ ] Se ve la franja ambar **"Sin conexion"**. No aparece la pantalla de login.
9. [ ] Navegar a Productos, Proveedores, Taras: se ven los datos.

**C. Pesaje sin red con fotos**

10. [ ] Pesaje > Compra > elegir proveedor > pesaje global con peso y **una foto con la camara** > material (con lote), tara, peso bruto y **foto**.
11. [ ] Pulsar **Generar ticket de pesaje**. Debe aparecer un codigo **PEND-n** y el formulario debe quedar **vacio**.
12. [ ] Repetir con un segundo pesaje: debe ser PEND-(n+1).
13. [ ] Con un formulario a medias (sin generar), cerrar y reabrir la app: el borrador y sus fotos se recuperan.
14. [ ] Cerrar sesion: debe aparecer **"Antes de cerrar sesion"** indicando 2 pendientes. Tocar **Exportar respaldo** (se descarga el JSON) y luego **Cancelar**.

**D. Volver la red**

15. [ ] Desactivar el modo avion. En menos de ~1 minuto la franja pasa a "En linea" y los PEND se envian.
16. [ ] En **Tickets** aparecen **2** tickets nuevos (no 3, no 4) con codigo definitivo; las fotos abren.
17. [ ] En Supabase (consulta 1b de la conciliacion): 2 operaciones `ok` del usuario de prueba, ambas con `entidad_id`.

**E. Casos de corte**

18. [ ] Generar un pesaje y activar modo avion **justo al pulsar** Generar (o durante "Guardando..."). Resultado esperado: queda PEND, o el ticket se crea; **nunca ambos ni ninguno**. Al volver la red, conciliar: un solo ticket.
19. [ ] Encolar un pesaje, cerrar sesion (confirmar "Salir"), volver a entrar **con red** con el mismo usuario: el pendiente sigue ahi y se envia.
20. [ ] Con 1 pendiente, abrir la app en dos pestanas del navegador a la vez y reconectar: se crea 1 ticket.
21. [ ] Pesaje que el servidor rechace (p. ej. una venta que supere el stock con la regla activa): queda en **rechazadas** con el motivo, datos y fotos intactos.
22. [ ] Pantalla de lectura (Cochinito/Inventario) sin red: franja "Sin conexion - datos de hace X" y botones de escritura deshabilitados. **(verificar F5)**
23. [ ] Con el telefono con poco almacenamiento (si es posible llenarlo con archivos): al encolar avisa y **no limpia** el formulario.

**F. Cierre**

24. [ ] Cola en 0, sin rechazadas inesperadas. Ejecutar consultas 2a (0 filas) y 3 (sin atascadas).
25. [ ] Registrar modelo de telefono, version de Chrome/Android y cualquier fallo con captura de pantalla.

---

## 8. Pruebas automaticas (referencia)

Suite Playwright con API simulada (no toca Supabase): `cd frontend && npm run test:e2e`. Compila el build de produccion a `dist-e2e` (con service worker) y lo sirve con `vite preview` en el puerto 4399. Variables: `E2E_PUERTO`, `E2E_SIN_BUILD=1` (reutiliza `dist-e2e`). Informe HTML en `frontend/e2e/resultados/informe/` y JSON en `frontend/e2e/resultados/resultados.json`.

Las pruebas de piezas aun no integradas estan marcadas `test.fixme` con la razon y **se activan solas** cuando el codigo existe (ver `e2e/support/implementado.ts`).
