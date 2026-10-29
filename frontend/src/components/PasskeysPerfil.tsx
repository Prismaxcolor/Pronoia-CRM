import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { PasskeyResumen } from '@shared/types/passkey.js';
import { useToast } from '../hooks/use-toast-context';
import { eliminarPasskey, listarPasskeys, registrarPasskey, browserSupportsWebAuthn } from '../services/passkey-service';
import {
  clasificarErrorPasskey,
  LARGO_MAX_NOMBRE_PASSKEY,
  MENSAJE_PASSKEY_NO_SOPORTADA,
  MENSAJE_PASSKEY_REGISTRO_FALLIDO,
  normalizarNombrePasskey,
} from '../lib/passkey-logica';
import { mensajeAmigable } from '../lib/mensaje-error';
import { formatearFechaNegocio } from '../lib/fecha-negocio';

const BOTON = 'min-h-11 rounded-lg border border-border-strong px-4 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50';
const BOTON_PRIMARIO = 'flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-text-on-brand hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50';
const BOTON_PELIGRO = 'min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50';
const CAMPO = 'min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Passkeys del usuario (va en la pantalla de perfil): lista, alta con nombre opcional y baja con confirmación. */
function PasskeysPerfil() {
  const toast = useToast();
  const soportado = browserSupportsWebAuthn();
  const [passkeys, setPasskeys] = useState<PasskeyResumen[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setPasskeys(await listarPasskeys());
      setErrorCarga(null);
    } catch (err) {
      setErrorCarga(mensajeAmigable(err, { porDefecto: 'No se pudieron cargar tus passkeys.' }));
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    listarPasskeys().then(
      lista => { if (vigente) setPasskeys(lista); },
      (err: unknown) => { if (vigente) setErrorCarga(mensajeAmigable(err, { porDefecto: 'No se pudieron cargar tus passkeys.' })); },
    );
    return () => { vigente = false; };
  }, []);

  const cerrarAlta = () => {
    setAgregando(false);
    setNombre('');
    setPassword('');
    setError(null);
  };

  const agregar = async (e: FormEvent) => {
    e.preventDefault();
    const clave = password;
    setPassword('');
    setTrabajando(true);
    setError(null);
    try {
      const nueva = await registrarPasskey(clave, normalizarNombrePasskey(nombre));
      setPasskeys(actuales => [...(actuales ?? []), nueva]);
      cerrarAlta();
      toast.exito('Passkey agregada. Ya puedes entrar con ella desde el login.');
    } catch (err) {
      const porDefecto = mensajeAmigable(err, { porDefecto: MENSAJE_PASSKEY_REGISTRO_FALLIDO, mensajesLocales: true });
      const clasificado = clasificarErrorPasskey(err, porDefecto);
      // Cancelar el diálogo del dispositivo no es un error.
      if (clasificado.mensaje) setError(clasificado.mensaje);
    } finally {
      setTrabajando(false);
    }
  };

  const cancelarEliminar = () => {
    setAEliminar(null);
    setPassword('');
    setError(null);
  };

  const eliminar = async (e: FormEvent, id: string) => {
    e.preventDefault();
    const clave = password;
    setPassword('');
    setTrabajando(true);
    setError(null);
    try {
      await eliminarPasskey(id, clave);
      setPasskeys(actuales => (actuales ?? []).filter(p => p.id !== id));
      setAEliminar(null);
      toast.exito('Passkey eliminada.');
    } catch (err) {
      setError(mensajeAmigable(err, { porDefecto: 'No se pudo eliminar la passkey.' }));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-text-secondary">
        Entra sin contraseña con tu huella, rostro o el bloqueo de tu dispositivo. Tu contraseña sigue funcionando.
      </p>

      {!soportado && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{MENSAJE_PASSKEY_NO_SOPORTADA}</p>
      )}

      {errorCarga && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-red-700">
          <span>{errorCarga}</span>
          <button type="button" onClick={() => void cargar()} className={BOTON}>Reintentar</button>
        </div>
      )}

      {!errorCarga && passkeys === null && (
        <p className="flex items-center gap-2 text-text-secondary">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Cargando...
        </p>
      )}

      {passkeys !== null && passkeys.length === 0 && <p className="text-text-secondary">Aún no tienes passkeys registradas.</p>}

      {passkeys !== null && passkeys.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {passkeys.map(p => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-text-primary">{p.nombre}</p>
                <p className="text-xs text-text-secondary">
                  Creada el {formatearFechaNegocio(p.creadoEn)} · {p.ultimoUso ? `Último uso: ${formatearFechaNegocio(p.ultimoUso)}` : 'Sin usar aún'}
                </p>
              </div>
              {aEliminar === p.id ? (
                <form onSubmit={e => void eliminar(e, p.id)} className="flex w-full flex-wrap items-end gap-2">
                  <div className="min-w-48 flex-1">
                    <label htmlFor={`passkey-borrar-${p.id}`} className="block text-xs font-medium text-text-secondary">
                      Contraseña actual para eliminarla
                    </label>
                    <input
                      id={`passkey-borrar-${p.id}`}
                      type="password"
                      value={password}
                      onChange={ev => setPassword(ev.target.value)}
                      autoComplete="current-password"
                      required
                      autoFocus
                      className={CAMPO}
                    />
                  </div>
                  <button type="submit" disabled={trabajando || password === ''} className={BOTON_PELIGRO}>Sí, eliminar</button>
                  <button type="button" disabled={trabajando} onClick={cancelarEliminar} className={BOTON}>Cancelar</button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAEliminar(p.id); setPassword(''); setError(null); }}
                  aria-label={`Eliminar passkey ${p.nombre}`}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {soportado && !agregando && (
        <button type="button" onClick={() => { setAgregando(true); setPassword(''); setError(null); }} className={BOTON_PRIMARIO}>
          <Plus size={16} aria-hidden="true" /> Agregar passkey
        </button>
      )}

      {soportado && agregando && (
        <form onSubmit={e => void agregar(e)} className="space-y-2">
          <label htmlFor="passkey-nombre" className="block text-xs font-medium text-text-secondary">
            Nombre (opcional, para reconocerla)
          </label>
          <input
            id="passkey-nombre"
            type="text"
            value={nombre}
            maxLength={LARGO_MAX_NOMBRE_PASSKEY}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej. Celular de Julio"
            autoComplete="off"
            className={CAMPO}
          />
          <label htmlFor="passkey-password" className="block text-xs font-medium text-text-secondary">
            Contraseña actual (para confirmar que eres tú)
          </label>
          <input
            id="passkey-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className={CAMPO}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={trabajando || password === ''} className={BOTON_PRIMARIO}>
              {trabajando
                ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Esperando tu dispositivo...</>
                : 'Crear passkey'}
            </button>
            <button type="button" disabled={trabajando} onClick={cerrarAlta} className={BOTON}>Cancelar</button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  );
}

export default PasskeysPerfil;
