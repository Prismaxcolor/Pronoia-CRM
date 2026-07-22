# Plan RLS — segunda tanda

## Estado actual (mayo 2026)

- El frontend habla **directo** a Supabase con la `VITE_SUPABASE_ANON_KEY` (clave pública, expuesta en el browser).
- El backend Express solo es responsable de auth (JWT) y de tasas de cambio.
- RLS está **deshabilitado** en `bancas`, `movimientos`, `productos`, `users`, `facturas`, `factura_items` (ver `supabase-schema.sql` Bloque 4).
- Cualquiera con la anon key puede leer/escribir cualquier tabla. Es la deuda técnica más grande del sistema.

## Por qué no se puede activar RLS hoy

Las policies de Supabase normalmente se basan en `auth.uid()`, que es el ID del usuario autenticado en **Supabase Auth**. Pronoia no usa Supabase Auth — usa JWT propio firmado por el backend. Desde el frontend, `auth.uid()` siempre es `NULL`, así que cualquier policy basada en eso bloquearía todas las operaciones.

Hay dos formas de cerrar esto:

1. **Migrar a Supabase Auth.** Descartado: el motivo de mover a JWT propio fue dejar de depender de los métodos de Supabase Auth (RPCs custom inestables).
2. **Routear todas las escrituras (y/o lecturas sensibles) por el backend Express**, que tiene la `SUPABASE_SERVICE_KEY` (bypassa RLS). Una vez hecho esto, se cierra RLS para la anon key con policies simples (`USING (false)` para `INSERT/UPDATE/DELETE`).

Esta segunda opción es la que vamos a implementar.

## Plan de migración (incremental)

### Fase A — endpoints de escritura en backend

Crear endpoints REST que reemplacen las llamadas directas a Supabase del frontend. Cada uno valida JWT con `requireAuth` y permisos con la matriz `PERMISOS_POR_ROL`.

**✅ Bancas y movimientos: hecho (jul 2026).** A diferencia de la tabla original, se movieron también las **lecturas** al backend (no solo las escrituras) — ver nota en Fase B. Endpoints reales implementados en `backend/src/routes/cochinito.ts`:

| Recurso | Método | Path | Permiso requerido |
|---|---|---|---|
| Bancas | GET | `/api/cochinito/bancas` | `cochinito:ver` |
| Bancas | POST | `/api/cochinito/bancas` | `cochinito:crear` |
| Bancas | PATCH | `/api/cochinito/bancas/:id` | `cochinito:editar` |
| Bancas | POST | `/api/cochinito/bancas/:id/archivar` | `cochinito:editar` |
| Bancas | POST | `/api/cochinito/bancas/:id/desarchivar` | `cochinito:editar` |
| Movimientos | GET | `/api/cochinito/movimientos` | `cochinito:ver` |
| Movimientos | POST | `/api/cochinito/movimientos` | `cochinito:crear` |

También se creó `POST /api/uploads/:tipo` (`productos`\|`tickets`\|`taras`) para que la subida de imágenes (antes directa a Supabase Storage con la anon key) pase por el backend con `multer` + la service key.

**Pendiente:** `Productos` | `Facturas` | `Usuarios admin` (ver tabla original de esta fase — no tocado aún).

### Fase B — RLS

Con bancas y movimientos moviendo **tanto lecturas como escrituras** al backend, esas dos tablas no necesitan la variante "solo SELECT para anon" — pueden ir directo a **deny-all**, porque ningún cliente anon debe tocarlas nunca:

```sql
alter table public.bancas enable row level security;
alter table public.movimientos enable row level security;

create policy bancas_deny_anon on public.bancas for all to anon using (false) with check (false);
create policy movimientos_deny_anon on public.movimientos for all to anon using (false) with check (false);
```

Para las tablas que **sigan** con lectura directa desde el frontend (`productos`, `facturas`, etc., mientras no se migren en Fase A), aplicar el patrón original de solo-SELECT:

```sql
-- Ejemplo para una tabla que aún no pasa por backend
create policy productos_select_anon
  on public.productos
  for select
  to anon
  using (true);

create policy productos_no_write_anon
  on public.productos
  for all
  to anon
  using (false)
  with check (false);
```

### Estado tras Fase B (mayo 2026)

El módulo `usuarios` ya pasa **100% por el backend** (`/api/usuarios/*`). El frontend ya no llama a `supabase.from('users')` desde `usuario-service.ts` ni a la RPC `create_user`.

**Sin embargo, NO podemos aún activar RLS en `users`** porque:

- `frontend/src/services/factura-service.ts` hace `select('*, factura_items(*), users!creado_por(nombre)')` — un join de Supabase para mostrar el nombre del creador en el listado de facturas. Si cerramos RLS en `users`, ese join devuelve `null` y el historial pierde los nombres.

**Opciones para resolver en Fase C (cuando migremos facturas al backend):**

1. **Mover la lectura de facturas al backend** (el más limpio): el backend hace el join con service_role, devuelve facturas con `nombreCreador` ya resuelto. Cero acceso a `users` desde anon.
2. **Denormalizar:** guardar `nombre_creador` directamente en la fila de `factura` al momento de crearla. Pierde la sincronía si el usuario cambia su nombre, pero corta la dependencia.

Recomendación: opción 1, va alineada con la migración de facturas a backend que toca igual.

### Fase C — `users` requiere policy más estricta

La tabla `users` contiene `password_hash`. **Nunca** debe ser legible desde el frontend.

```sql
alter table public.users enable row level security;

-- anon no puede leer users (ni siquiera para listar nombres)
create policy users_no_read_anon
  on public.users
  for select
  to anon
  using (false);
```

Las páginas que listan usuarios (admin) ya pasarán por backend en Fase A.

### Fase D — auditoría

Una vez todas las escrituras pasan por backend, agregar tabla `auditoria` que el backend popula automáticamente en cada mutación (CLAUDE.md exige auditoría obligatoria en finanzas):

```sql
create table public.auditoria (
  id          uuid        primary key default gen_random_uuid(),
  usuario_id  uuid        not null references public.users(id),
  accion      text        not null, -- 'crear_movimiento', 'archivar_banca', etc.
  recurso     text        not null, -- 'movimiento', 'banca', etc.
  recurso_id  uuid        not null,
  payload     jsonb,                -- snapshot del before/after
  creado_en   timestamptz not null default now()
);
```

## Estimación

- Fase A: ~3-4 días (cada recurso son ~2-3 archivos: ruta + servicio backend + refactor del service del front).
- Fase B + C: ~1 día (es solo SQL).
- Fase D: ~1 día (middleware de auditoría que envuelve los handlers).

**Total estimado: 5-6 días.**

## Cómo verificar que RLS está bien aplicado

Después de Fase B, este curl debe fallar:

```bash
curl -X POST 'https://<proyecto>.supabase.co/rest/v1/bancas' \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"hack","tipo":"efectivo","moneda":"USD"}'
# Esperado: 401/403
```

Y este SELECT debe seguir funcionando (lectura pública controlada):

```bash
curl 'https://<proyecto>.supabase.co/rest/v1/bancas?select=nombre,saldo' \
  -H "apikey: <ANON_KEY>"
# Esperado: 200 con la lista de bancas activas
```
