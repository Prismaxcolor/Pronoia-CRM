import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ENV } from './config/env.js';
import healthRouter from './routes/health.js';
import tasasRouter from './routes/tasas.js';
import authRouter from './routes/auth.js';
import usuariosRouter from './routes/usuarios.js';
import productosRouter from './routes/productos.js';
import clientesRouter from './routes/clientes.js';

const app = express();

// trust proxy: necesario para que express-rate-limit y req.ip funcionen
// detrás de un reverse proxy (Render, Railway, Nginx). En dev no estorba.
app.set('trust proxy', 1);

app.use(helmet());

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // requests sin Origin (curl, healthchecks server-to-server) se permiten
    if (!origin) return cb(null, true);

    // dev: permite cualquier localhost si no se configuró whitelist
    if (ENV.NODE_ENV !== 'production' && ENV.CORS_ORIGINS.length === 0) {
      const esLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (esLocal) return cb(null, true);
    }

    if (ENV.CORS_ORIGINS.includes(origin)) return cb(null, true);

    cb(new Error(`Origen ${origin} no permitido por CORS.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));

app.use(healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/productos', productosRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/tasas', tasasRouter);

export default app;
