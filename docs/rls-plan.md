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

| Recurso | Método | Path | Permiso requerido |
|---|---|---|---|
| Bancas | POST | `/api/bancas` | `cochinito:crear` |
| Bancas | PATCH | `/api/bancas/:id` | `cochinito:editar` |
| Bancas | POST | `/api/bancas/:id/archivar` | `cochinito:eliminar` |
| Bancas | POST | `/api/bancas/:id/desarchivar` | `cochinito:eliminar` |
| Movimientos | POST | `/api/movimientos` | `cochinito:crear` |
| Movimientos | POST | `/api/movimientos/:id/reversar` | `cochinito:editar` (no hay delete real) |
| Productos | POST/PATCH/DELETE | `/api/productos*` | según acción |
| Facturas | POST/PATCH/DELETE | `/api/facturas*` | según acción |
| Usuarios admin | POST/PATCH | `/api/usuarios*` | `usuarios:*` |

El frontend deja de importar `supabase` para escrituras y pasa todo por `apiFetch`.

### Fase B — RLS solo lectura para anon

Las **lecturas** pueden seguir siendo directas desde el frontend (es lo que más pesa en latencia). Activamos RLS con policies de solo SELECT para anon:

```sql
-- Ejemplo para bancas
alter table public.bancas enable row level security;

create policy bancas_select_anon
  on public.bancas
  for select
  to anon
  using (archivada = false);

-- Bloquear cualquier escritura desde anon
create policy bancas_no_write_anon
  on public.bancas
  for all
  to anon
  using (false)
  with check (false);
```

Aplicar policies similares a `movimientos`, `productos`, `facturas`, `factura_items`.

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
