import { ENV } from './config/env.js';
import app from './app.js';

app.listen(ENV.PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${ENV.PORT}`);
  console.log(`Entorno: ${ENV.NODE_ENV}`);
});
