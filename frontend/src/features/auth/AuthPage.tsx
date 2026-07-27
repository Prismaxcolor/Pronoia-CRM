import { useState, type ReactNode } from 'react';
import { Mail, Lock, User, Eye, EyeOff, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';

interface NivelFuerza { score: number; label: string; color: string }

/** Heurística simple client-side: longitud + variedad de caracteres. Solo
 *  para dar feedback visual al registrarse, la validación real (min 8) la
 *  hace el backend. */
function fuerzaPassword(pw: string): NivelFuerza {
  const NIVELES = [
    { label: 'Muy débil', color: 'bg-red-500' },
    { label: 'Débil', color: 'bg-orange-500' },
    { label: 'Aceptable', color: 'bg-amber-500' },
    { label: 'Buena', color: 'bg-lime-500' },
    { label: 'Fuerte', color: 'bg-green-500' },
  ];
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const idx = Math.min(score, NIVELES.length - 1);
  return { score: idx + 1, ...NIVELES[idx] };
}

const inputClass =
  'w-full pl-10 pr-10 py-3 bg-surface-alt border border-border rounded-lg text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent ' +
  'transition-all placeholder:text-text-muted';

interface CampoProps {
  id: string;
  label: string;
  type: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  minLength?: number;
  autoFocus?: boolean;
  rightSlot?: ReactNode;
  onKeyUp?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** Campo de formulario con ícono a la izquierda y slot opcional a la derecha
 *  (usado para el botón de mostrar/ocultar contraseña). */
function Campo({ id, label, type, icon, value, onChange, placeholder, autoComplete, minLength, autoFocus, rightSlot, onKeyUp }: CampoProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-text-secondary mb-1">
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
          {icon}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyUp={onKeyUp}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          autoFocus={autoFocus}
          required
          className={inputClass}
        />
        {rightSlot && <span className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</span>}
      </div>
    </div>
  );
}

function ToggleVerPassword({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      className="text-text-muted hover:text-text-primary transition-colors"
      aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
    >
      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  );
}

function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [remember, setRemember] = useState(true);
  const [verPassword, setVerPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const { login, registro } = useAuth();
  const toast = useToast();

  const detectarCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(e.getModifierState?.('CapsLock') ?? false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMensaje(null);

    try {
      if (isLogin) {
        await login(email, password, remember);
        toast.exito(`Bienvenido${nombre ? `, ${nombre}` : ''}.`);
      } else {
        await registro(email, password, nombre);
        toast.exito('Cuenta creada. Ya estás dentro.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      setMensaje(msg);
      toast.errorMsg(msg);
      setShake(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setMensaje(null);
    setEmail('');
    setPassword('');
    setNombre('');
    setVerPassword(false);
    setCapsLockOn(false);
  };

  const fuerza = fuerzaPassword(password);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface to-brand-100 p-4">
      <div className="relative w-full max-w-[900px] min-h-[580px] bg-surface rounded-2xl shadow-2xl overflow-hidden flex">

        {/* Panel decorativo con slider — solo en pantallas md+, en mobile no hay
            espacio para dos columnas y el toggle de abajo ya cubre esa función. */}
        <div
          className={`
            hidden md:flex absolute top-0 h-full w-1/2 bg-gradient-to-br from-brand-600 to-brand-900
            flex-col items-center justify-center text-text-on-brand p-10 z-10
            transition-transform duration-700 ease-in-out
            ${isLogin ? 'translate-x-full' : 'translate-x-0'}
          `}
        >
          <div className="text-center">
            <h2 className="text-3xl font-bold mb-4">
              {isLogin ? 'Bienvenido de vuelta' : 'Hola, bienvenido'}
            </h2>
            <p className="text-brand-200 mb-8 text-sm leading-relaxed">
              {isLogin
                ? 'Para mantenerte conectado, inicia sesión con tus datos personales'
                : 'Regístrate para empezar a gestionar tus compras y tesorería'
              }
            </p>
            <button
              type="button"
              onClick={toggleMode}
              className="px-8 py-3 border-2 border-white rounded-full text-sm font-semibold
                         hover:bg-white hover:text-brand-700 transition-colors duration-300
                         uppercase tracking-wider"
            >
              {isLogin ? 'Crear cuenta' : 'Iniciar sesión'}
            </button>
          </div>

          {/* Círculos decorativos */}
          <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-brand-500/20 rounded-full" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-400/15 rounded-full" />
        </div>

        {/* Formulario de Login */}
        <div
          className={`
            w-full md:w-1/2 flex flex-col items-center justify-center p-6 sm:p-10
            transition-all duration-700 ease-in-out
            ${isLogin ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none absolute'}
          `}
        >
          <h1 className="text-2xl font-bold text-text-primary mb-2">Iniciar sesión</h1>
          <p className="text-text-secondary text-sm mb-8">Ingresa tus credenciales</p>

          <form
            onSubmit={handleSubmit}
            onAnimationEnd={() => setShake(false)}
            className={`w-full max-w-xs space-y-4 ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}
          >
            <Campo
              id="login-email"
              label="Correo electrónico"
              type="email"
              icon={<Mail size={17} />}
              value={email}
              onChange={setEmail}
              placeholder="tu@correo.com"
              autoComplete="username"
              autoFocus
            />

            <div>
              <Campo
                id="login-password"
                label="Contraseña"
                type={verPassword ? 'text' : 'password'}
                icon={<Lock size={17} />}
                value={password}
                onChange={setPassword}
                onKeyUp={detectarCapsLock}
                placeholder="••••••••"
                autoComplete="current-password"
                minLength={8}
                rightSlot={<ToggleVerPassword visible={verPassword} onClick={() => setVerPassword(v => !v)} />}
              />
              {capsLockOn && (
                <p className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-600">
                  <AlertTriangle size={13} />
                  Bloq Mayús está activado.
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="w-4 h-4 accent-brand-600"
              />
              Recordarme en este dispositivo
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-brand-600 text-white rounded-lg font-semibold text-sm
                         hover:bg-brand-700 active:bg-brand-800 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
            >
              {loading ? <><Loader2 size={16} className="animate-spin" /> Entrando...</> : 'Entrar'}
            </button>
          </form>

          {mensaje && (
            <div className="mt-4 w-full max-w-xs flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{mensaje}</p>
            </div>
          )}

          {/* Botón mobile toggle */}
          <button
            type="button"
            onClick={toggleMode}
            className="mt-6 text-sm text-brand-600 hover:text-brand-800 md:hidden"
          >
            ¿No tienes cuenta? Regístrate
          </button>
        </div>

        {/* Formulario de Registro */}
        <div
          className={`
            w-full md:w-1/2 flex flex-col items-center justify-center p-6 sm:p-10
            transition-all duration-700 ease-in-out
            ${!isLogin ? 'opacity-100 translate-x-0 md:translate-x-full' : 'opacity-0 translate-x-full pointer-events-none absolute right-0'}
          `}
        >
          <h1 className="text-2xl font-bold text-text-primary mb-2">Crear cuenta</h1>
          <p className="text-text-secondary text-sm mb-8">Completa tus datos</p>

          <form
            onSubmit={handleSubmit}
            onAnimationEnd={() => setShake(false)}
            className={`w-full max-w-xs space-y-4 ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}
          >
            <Campo
              id="registro-nombre"
              label="Nombre completo"
              type="text"
              icon={<User size={17} />}
              value={nombre}
              onChange={setNombre}
              placeholder="Tu nombre"
              autoComplete="name"
              autoFocus={!isLogin}
            />
            <Campo
              id="registro-email"
              label="Correo electrónico"
              type="email"
              icon={<Mail size={17} />}
              value={email}
              onChange={setEmail}
              placeholder="tu@correo.com"
              autoComplete="username"
            />

            <div>
              <Campo
                id="registro-password"
                label="Contraseña"
                type={verPassword ? 'text' : 'password'}
                icon={<Lock size={17} />}
                value={password}
                onChange={setPassword}
                onKeyUp={detectarCapsLock}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                minLength={8}
                rightSlot={<ToggleVerPassword visible={verPassword} onClick={() => setVerPassword(v => !v)} />}
              />
              {capsLockOn && (
                <p className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-600">
                  <AlertTriangle size={13} />
                  Bloq Mayús está activado.
                </p>
              )}
              {password && (
                <div className="mt-1.5">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full ${i < fuerza.score ? fuerza.color : 'bg-border'}`} />
                    ))}
                  </div>
                  <p className="text-xs text-text-muted mt-1">{fuerza.label}</p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-brand-600 text-white rounded-lg font-semibold text-sm
                         hover:bg-brand-700 active:bg-brand-800 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
            >
              {loading ? <><Loader2 size={16} className="animate-spin" /> Registrando...</> : 'Registrarse'}
            </button>
          </form>

          {mensaje && (
            <div className="mt-4 w-full max-w-xs flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{mensaje}</p>
            </div>
          )}

          <button
            type="button"
            onClick={toggleMode}
            className="mt-6 text-sm text-brand-600 hover:text-brand-800 md:hidden"
          >
            ¿Ya tienes cuenta? Inicia sesión
          </button>
        </div>

      </div>
    </div>
  );
}

export default AuthPage;
