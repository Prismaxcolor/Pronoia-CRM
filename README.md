# Pronoia-CRM

Aplicación web full-stack para gestión de relaciones con clientes.

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Express + TypeScript

## Estructura

```
frontend/   → Aplicación React (Vite + TS)
backend/    → API REST (Express + TS)
shared/     → Tipos y utilidades compartidas
docs/       → Documentación del proyecto
```

## Inicio rápido

1. Clonar el repositorio
2. Copiar los archivos `.env.example` a `.env` en `frontend/` y `backend/`
3. Instalar dependencias en cada subproyecto: `npm install`
4. Arrancar el backend: `cd backend && npm run dev`
5. Arrancar el frontend: `cd frontend && npm run dev`