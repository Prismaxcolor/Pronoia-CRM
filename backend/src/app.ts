import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import tasasRouter from './routes/tasas.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use(healthRouter);
app.use('/api/tasas', tasasRouter);

export default app;
