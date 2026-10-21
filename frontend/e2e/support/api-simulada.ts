/** Backend simulado para las pruebas e2e. Se engancha con context.route sobre
 *  /api/** (incluye peticiones del service worker). NUNCA hay trafico a Supabase
 *  ni a un backend real: cualquier peticion que no sea /api/** se deja pasar solo
 *  si es del propio servidor de pruebas (ver `bloquearExterno`).
 *
 *  Capacidades:
 *   - Contadores y bitacora de cada peticion (para afirmar "llego UNA sola vez").
 *   - Idempotencia por clientRequestId (como backend/src/services/idempotencia-service.ts).
 *   - Fallos programables: respuesta perdida (el servidor procesa pero el cliente no
 *     recibe nada), 401, 409, 5xx, latencia, red caida.
 */
import type { BrowserContext, Route, Request } from '@playwright/test';
import {
  ALMACENES, CLIENTES, ID, ID_TOMA, LOTES, TOMA_ABIERTA, PRODUCTOS, PROVEEDORES, STOCK_GLOBAL, TARAS, TICKETS_INICIALES,
  TIPOS_MATERIAL, USUARIOS, VEHICULOS, jwtFalso, type RolE2E,
} from '../fixtures/datos';

export interface PeticionRegistrada {
  metodo: string;
  ruta: string; // pathname + search
  cuerpo: unknown;
  auth: string | null;
  contentType: string | null;
}

/** Una respuesta guionizada para la siguiente peticion que coincida. */
export type Guion =
  | { tipo: 'estado'; status: number; cuerpo?: unknown }
  /** El servidor PROCESA la peticion (crea el registro) pero la respuesta nunca llega. */
  | { tipo: 'respuesta-perdida' }
  /** La peticion nunca llega al servidor (corte antes de enviar). */
  | { tipo: 'corte-antes' }
  | { tipo: 'retraso'; ms: number };

interface Regla {
  metodo: string;
  patron: RegExp;
  guiones: Guion[];
  /** Si true la regla no se consume (se aplica siempre). */
  persistente: boolean;
}

export class ApiSimulada {
  readonly peticiones: PeticionRegistrada[] = [];
  /** Peticiones GET /api/** sin respuesta definida (ayuda a detectar huecos del simulador). */
  readonly noSimuladas: string[] = [];
  /** Cuerpos de POST /api/tickets-pesaje recibidos (incluye reintentos). */
  readonly postsTicket: Array<Record<string, unknown>> = [];
  /** Tickets realmente CREADOS (despues de la idempotencia). */
  readonly ticketsCreados: Array<Record<string, unknown>> = [];
  /** Peticiones que intentaron salir a un origen distinto del de pruebas (deben ser SIEMPRE 0). */
  readonly bloqueadas: string[] = [];
  subidas = 0;
  conteosCreados = 0;
  proveedoresCreados = 0;

  online = true;
  /** Si true, cualquier ruta autenticada responde 401. */
  sesionExpirada = false;
  rolActual: RolE2E = 'superadmin';
  offlineActivo = true;
  /** Stock global por producto para el aviso/rechazo de venta. */
  stockGlobal: Record<string, number> = { ...STOCK_GLOBAL };

  private readonly reglas: Regla[] = [];
  private readonly resultadosPorClave = new Map<string, unknown>();
  private contadorTickets = TICKETS_INICIALES.length;
  private ticketsServidor: Array<Record<string, unknown>> = [...TICKETS_INICIALES];

  constructor(private readonly origenPermitido: string) {}

  // --- Instalacion ---------------------------------------------------------

  async instalar(context: BrowserContext): Promise<void> {
    await context.route(url => { const r = new URL(url).pathname; return r.startsWith('/api/') || r === '/health'; }, route => this.manejar(route));
    // Cualquier otro origen externo (fuentes, analiticas, Supabase) se bloquea: aislamiento total.
    await context.route(url => new URL(url).origin !== this.origenPermitido && !/^(data|blob|about):/.test(url.href), route => {
      this.bloqueadas.push(`${route.request().method()} ${route.request().url()}`);
      void route.abort('blockedbyclient');
    });
  }

  // --- Control de red y fallos --------------------------------------------

  /** Modo avion en el simulador (el test tambien debe llamar a context.setOffline). */
  setOnline(valor: boolean) { this.online = valor; }

  guionar(metodo: string, patron: RegExp, ...guiones: Guion[]) {
    this.reglas.push({ metodo: metodo.toUpperCase(), patron, guiones, persistente: false });
  }

  guionarSiempre(metodo: string, patron: RegExp, guion: Guion) {
    this.reglas.push({ metodo: metodo.toUpperCase(), patron, guiones: [guion], persistente: true });
  }

  limpiarGuiones() { this.reglas.length = 0; }

  // --- Consultas para afirmaciones ----------------------------------------

  contar(metodo: string, patron: RegExp): number {
    return this.peticiones.filter(p => p.metodo === metodo.toUpperCase() && patron.test(p.ruta)).length;
  }

  cuerpos(metodo: string, patron: RegExp): Array<Record<string, unknown>> {
    return this.peticiones
      .filter(p => p.metodo === metodo.toUpperCase() && patron.test(p.ruta))
      .map(p => (p.cuerpo ?? {}) as Record<string, unknown>);
  }

  // --- Manejo de peticiones ------------------------------------------------

  private siguienteGuion(metodo: string, ruta: string): Guion | null {
    for (let i = 0; i < this.reglas.length; i += 1) {
      const r = this.reglas[i];
      if (r.metodo !== metodo || !r.patron.test(ruta)) continue;
      if (r.persistente) return r.guiones[0];
      const g = r.guiones.shift();
      if (r.guiones.length === 0) this.reglas.splice(i, 1);
      if (g) return g;
    }
    return null;
  }

  private leerCuerpo(req: Request): unknown {
    const tipo = req.headers()['content-type'] ?? '';
    if (tipo.includes('multipart')) return { __multipart: true };
    const texto = req.postData();
    if (!texto) return null;
    try { return JSON.parse(texto); } catch { return texto; }
  }

  private async manejar(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    const ruta = url.pathname + url.search;
    const metodo = req.method();
    const cuerpo = this.leerCuerpo(req);

    if (!this.online) { await route.abort('internetdisconnected'); return; }

    const guion = this.siguienteGuion(metodo, ruta);
    if (guion?.tipo === 'corte-antes') { await route.abort('connectionreset'); return; }

    // La peticion LLEGA al servidor: se registra.
    this.peticiones.push({
      metodo, ruta, cuerpo,
      auth: req.headers()['authorization'] ?? null,
      contentType: req.headers()['content-type'] ?? null,
    });

    if (guion?.tipo === 'retraso') await new Promise(r => setTimeout(r, guion.ms));

    // Sonda de conexion de la app (HEAD /health): solo responde si hay red.
    if (url.pathname === '/health') { await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); return; }

    const esPublica = ruta.startsWith('/api/auth/login');
    if (!esPublica && this.sesionExpirada) { await this.json(route, 401, { error: 'Sesión vencida.' }); return; }

    if (guion?.tipo === 'estado') {
      // Un 5xx/4xx guionizado NO procesa nada.
      await this.json(route, guion.status, guion.cuerpo ?? { error: `Error simulado ${guion.status}` });
      return;
    }

    const respuesta = await this.responder(metodo, url, cuerpo);

    if (guion?.tipo === 'respuesta-perdida') {
      // El servidor ya hizo el trabajo (arriba), pero el cliente no recibe respuesta.
      await route.abort('connectionreset');
      return;
    }
    await this.json(route, respuesta.status, respuesta.cuerpo);
  }

  private async json(route: Route, status: number, cuerpo: unknown) {
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });
  }

  private usuarioActual() { return USUARIOS[this.rolActual]; }

  private async responder(metodo: string, url: URL, cuerpo: unknown): Promise<{ status: number; cuerpo: unknown }> {
    const p = url.pathname;
    const ok = (c: unknown) => ({ status: 200, cuerpo: c });

    // --- Autenticacion
    if (p === '/api/auth/login' && metodo === 'POST') {
      const email = String((cuerpo as { email?: string } | null)?.email ?? '').toLowerCase();
      const rol = (Object.keys(USUARIOS) as RolE2E[]).find(r => USUARIOS[r].email === email);
      if (!rol) return { status: 401, cuerpo: { error: 'Credenciales inválidas.' } };
      this.rolActual = rol;
      return ok({ token: jwtFalso(rol), usuario: USUARIOS[rol] });
    }
    if (p === '/api/auth/me') return ok({ usuario: this.usuarioActual() });
    if (p === '/api/auth/offline-config') return ok({ activo: this.offlineActivo, ahoraServidor: Date.now() });

    // --- Catalogos (GET)
    if (metodo === 'GET') {
      switch (p) {
        case '/api/productos': return ok({ productos: PRODUCTOS });
        case '/api/proveedores': return ok({ proveedores: PROVEEDORES });
        case '/api/clientes': return ok({ clientes: CLIENTES });
        case '/api/taras': return ok({ taras: TARAS });
        case '/api/almacenes': return ok({ almacenes: ALMACENES });
        case '/api/almacenes/stock-global': return ok({ stock: this.stockGlobal });
        case '/api/lotes': return ok({ lotes: LOTES });
        case '/api/vehiculos': return ok({ vehiculos: VEHICULOS });
        case '/api/tipos-material': return ok({ tipos: TIPOS_MATERIAL });
        case '/api/traslados': return ok({ traslados: [] });
        case '/api/tomas-fisicas': return ok({ tomasFisicas: [TOMA_ABIERTA] });
        case '/api/tickets-pesaje': return ok({ tickets: this.ticketsServidor });
        case '/api/llaves-solicitudes/pendientes/conteo': return ok({ pendientes: 0 });
        case '/api/cochinito/bancas': return ok({ bancas: [] });
        case '/api/cochinito/movimientos': return ok({ movimientos: [] });
        case '/api/listas-precios': return ok({ listas: [] });
        case '/api/tasas/oficial': return ok({ tasa: null });
        case '/api/portal/me': return { status: 401, cuerpo: { error: 'Sin sesión de portal.' } };
        case '/api/llaves-edicion/config': return ok({ requiereLlave: false });
        default: break;
      }
      if (p === `/api/tomas-fisicas/${ID_TOMA}`) return ok({ tomaFisica: TOMA_ABIERTA, detalle: [] });
      if (p === `/api/tomas-fisicas/${ID_TOMA}/resumen`) return ok({ lineas: [] });
      if (/^\/api\/almacenes\/[^/]+\/stock$/.test(p)) return ok({ stock: this.stockGlobal });
      const t = /^\/api\/tickets-pesaje\/([^/]+)$/.exec(p);
      if (t) {
        const ticket = this.ticketsServidor.find(x => x.id === t[1]);
        return ticket ? ok({ ticket }) : { status: 404, cuerpo: { error: 'No encontrado.' } };
      }
      this.noSimuladas.push(p);
      return { status: 404, cuerpo: { error: `Ruta no simulada: ${p}` } };
    }

    // --- Subida de archivos
    if (p.startsWith('/api/uploads/') && metodo === 'POST') {
      this.subidas += 1;
      return ok({ url: `https://almacenamiento.e2e.test/${p.split('/').pop()}/foto-${this.subidas}.jpg` });
    }

    // --- Altas de maestros (proveedor): idempotentes por clientRequestId como el backend
    if (p === '/api/proveedores' && metodo === 'POST') {
      const entrada = (cuerpo ?? {}) as Record<string, unknown>;
      const clave = typeof entrada.clientRequestId === 'string' ? entrada.clientRequestId : null;
      if (clave && this.resultadosPorClave.has(clave)) return { status: 200, cuerpo: this.resultadosPorClave.get(clave) };
      this.proveedoresCreados += 1;
      const proveedor = { ...PROVEEDORES[0], id: `aaaaaaa9-0000-4000-8000-${String(Date.now()).padStart(12, '0').slice(-12)}`, nombre: String(entrada.nombre ?? 'Nuevo') };
      if (clave) this.resultadosPorClave.set(clave, { proveedor });
      return { status: 201, cuerpo: { proveedor } };
    }

    // --- Toma fisica: registrar un pesaje de conteo (idempotente)
    if (p === `/api/tomas-fisicas/${ID_TOMA}/pesajes` && metodo === 'POST') {
      const entrada = (cuerpo ?? {}) as Record<string, unknown>;
      const clave = typeof entrada.clientRequestId === 'string' ? entrada.clientRequestId : null;
      if (clave && this.resultadosPorClave.has(clave)) return { status: 200, cuerpo: this.resultadosPorClave.get(clave) };
      this.conteosCreados += 1;
      const r = { id: `cdcdcdcd-0000-4000-8000-${String(this.conteosCreados).padStart(12, '0')}` };
      if (clave) this.resultadosPorClave.set(clave, r);
      return { status: 201, cuerpo: r };
    }

    // --- Completar ticket en bruto
    if (/^\/api\/tickets-pesaje\/[^/]+\/completar$/.test(p) && metodo === 'PATCH') {
      return ok({ ticket: { ...TICKETS_INICIALES[0], estado: 'completo' } });
    }

    // --- Pesaje: crear ticket (idempotente por clientRequestId)
    if (p === '/api/tickets-pesaje' && metodo === 'POST') {
      return this.crearTicket((cuerpo ?? {}) as Record<string, unknown>);
    }

    this.noSimuladas.push(`${metodo} ${p}`);
    return { status: 404, cuerpo: { error: `Ruta no simulada: ${metodo} ${p}` } };
  }

  private crearTicket(input: Record<string, unknown>): { status: number; cuerpo: unknown } {
    this.postsTicket.push(input);
    const clave = typeof input.clientRequestId === 'string' ? input.clientRequestId : null;

    if (clave && this.resultadosPorClave.has(clave)) {
      // Reintento: devuelve el resultado guardado, sin crear nada.
      return { status: 200, cuerpo: this.resultadosPorClave.get(clave) };
    }

    // Regla de negocio simulada: una venta que excede el stock global se rechaza con 409.
    if (input.tipo === 'venta') {
      const materiales = (input.materiales ?? []) as Array<{ productoId: string; pesoBruto: number; tara: number }>;
      for (const m of materiales) {
        const neto = (m.pesoBruto ?? 0) - (m.tara ?? 0);
        if (neto > (this.stockGlobal[m.productoId] ?? 0)) {
          return { status: 409, cuerpo: { error: 'Stock insuficiente para esta venta.' } };
        }
      }
    }

    this.contadorTickets += 1;
    const numero = this.contadorTickets;
    const ticket = {
      id: `7777777${numero}-0000-4000-8000-${String(numero).padStart(12, '0')}`,
      numero,
      codigo: `Pesaje-${String(numero).padStart(4, '0')}`,
      tipo: input.tipo ?? 'compra',
      entidadId: input.entidadId,
      fecha: input.fecha ?? '2026-10-07',
      estado: input.estado ?? 'completo',
      pesoGlobal: input.pesoGlobal ?? 0,
      pesoNetoTotal: 0,
      devolucion: input.devolucion ?? 0,
      diferencia: 0,
      materiales: input.materiales ?? [],
      fotos: [],
      pesajesGlobales: input.pesajesGlobales ?? [],
      observaciones: input.observaciones ?? null,
      vehiculo: input.vehiculo ?? null,
      createdAt: new Date().toISOString(),
      clientRequestId: clave,
    };
    this.ticketsServidor = [ticket, ...this.ticketsServidor];
    this.ticketsCreados.push(ticket);
    const cuerpo = { ticket };
    if (clave) this.resultadosPorClave.set(clave, cuerpo);
    return { status: 201, cuerpo };
  }
}

export { ID };
