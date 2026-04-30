# Directrices del proyecto

## Sobre el proyecto
Aplicación web full-stack con frontend en React+Vite+TS y backend en Express+TS.
Monorepo con carpetas `frontend/` y `backend/` independientes.

## Contexto del proyecto (Pronoia)

Este NO es un CRM de ventas. Es un **sistema de compras + tesorería** para una empresa que COMPRA productos (no los vende). Inspirado en Kyte pero adaptado al flujo inverso.

### Módulos principales
1. **Productos recibidos**: catálogo de productos que la empresa adquiere, con nombre, descripción, precio de compra, categoría, etc.
2. **Cochinito (Tesorería)**: control de fondos en 3 bancas separadas:
   - Banca en Bolívares (Bs)
   - Banca en USD efectivo (presencial, en location de la empresa)
   - Banca en USD cuenta exterior
3. **Dashboard**: visión general inspirada en Kyte (movimientos, totales, gráficos).

### Reglas de dominio críticas
- Los **saldos** de las bancas NO se editan directamente. Se calculan a partir de **movimientos** (depósitos, retiros, transferencias entre bancas, gastos en compras).
- Cada movimiento debe registrar: monto, moneda, tipo, fecha, usuario que lo registró, descripción, banca origen/destino.
- Las tasas de cambio Bs↔USD se guardan con histórico (no solo la actual).
- En finanzas NUNCA se borra: se reversa con un movimiento contrario. Auditoría obligatoria.

### Lo que copiamos de Kyte
Gestión de productos, dashboard de métricas, multiusuario con permisos, control de inventario inbound, gestión de gastos, reportes.

### Lo que NO copiamos de Kyte
Catálogo público, recibos a clientes, links de pago, ventas por WhatsApp/IG, POS, carrito de cliente.

### Stack confirmado
- Frontend: Vite + React + TypeScript + Tailwind CSS
- Backend: Express + TypeScript (BD se decide después)
- Tipos compartidos en `shared/`

## Principios obligatorios

### Reutilización
- Antes de crear un componente, función o servicio nuevo, BUSCAR si ya existe algo similar.
- Componentes genéricos van en `frontend/src/components/`.
- Componentes específicos de un dominio van en `frontend/src/features/<dominio>/`.
- Lógica reutilizable del backend va en `backend/src/services/`.

### Variables de entorno
- NINGÚN valor sensible, URL, clave o configuración va hardcodeado.
- Todo va en `.env`, se documenta en `.env.example`.
- En frontend (Vite) las variables públicas empiezan con `VITE_`.
- En backend se cargan con `dotenv` desde `src/config/`.

### Estructura
- Respetar el árbol de carpetas definido. No crear carpetas nuevas sin justificación.
- Cada feature/módulo debe ser autocontenido cuando sea posible.

### TypeScript
- Tipado estricto. Nada de `any` salvo justificación explícita en comentario.
- Tipos compartidos entre front y back van en `shared/` (o se duplican con cuidado).

### Convenciones
- Archivos de componentes React: `PascalCase.tsx` (ej. `UserCard.tsx`).
- Otros archivos: `kebab-case.ts` (ej. `auth-service.ts`).
- Funciones y variables: `camelCase`.
- Constantes globales: `UPPER_SNAKE_CASE`.
- Una exportación por defecto por archivo de componente.

### Git
- Commits en formato Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Mensajes en español o inglés, pero consistentes.
- NUNCA push directo a `main`. Trabajar en ramas `feature/...` o `fix/...`.
- NUNCA commitear `.env`, `node_modules/`, ni archivos de build.

## Flujo de trabajo con Claude Code

1. Antes de cambios estructurales o de varios archivos, PROPONER el plan y esperar aprobación.
2. Antes de instalar una dependencia nueva, justificar por qué y esperar confirmación.
3. Después de cambios importantes, sugerir un mensaje de commit.
4. Si detectas código duplicado o mala práctica existente, avisar antes de continuar.

## Lo que NO debes hacer
- No hardcodear secrets ni URLs.
- No crear archivos sueltos en la raíz de `src/`.
- No instalar librerías "por si acaso".
- No reescribir código existente sin pedírmelo.


