/**
 * Entrypoint para Vercel Serverless Functions.
 *
 * Vercel detecta archivos en `api/` y los expone como funciones lambda. Aquí
 * exportamos la misma app Express que usamos localmente — el runtime
 * @vercel/node acepta una app Express como handler nativo.
 *
 * Caveats serverless:
 *  - express-rate-limit guarda contadores en memoria; entre cold starts se
 *    pierden. Para un demo no es crítico; en producción usar un store Redis.
 *  - Cada request tras 15 min idle paga ~2-5s de cold start.
 *  - Timeout de 10s por request en plan Hobby.
 */
import app from '../src/app.js';

export default app;
