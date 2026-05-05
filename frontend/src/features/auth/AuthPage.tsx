import { useState } from 'react';
import { useAuth } from '../../hooks/use-auth';

function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const { login, registro } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMensaje(null);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await registro(email, password, nombre);
        setMensaje('Registro exitoso. Revisa tu correo para confirmar la cuenta.');
      }
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : 'Error inesperado');
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
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface to-brand-100 p-4">
      <div className="relative w-full max-w-[900px] min-h-[540px] bg-surface rounded-2xl shadow-2xl overflow-hidden flex">

        {/* Panel decorativo con slider */}
        <div
          className={`
            absolute top-0 h-full w-1/2 bg-gradient-to-br from-brand-600 to-brand-900
            flex flex-col items-center justify-center text-text-on-brand p-10 z-10
            transition-transform duration-700 ease-in-out
            ${isLogin ? 'translate-x-full' : 'translate-x-0'}
          `}
        >
          <div className={`transition-opacity duration-500 text-center ${isLogin ? 'opacity-100' : 'opacity-100'}`}>
            <h2 className="text-3xl font-bold mb-4">
              {isLogin ? 'Bienvenido de vuelta' : 'Hola, bienvenido'}
            </h2>
            <p className="text-brand-200 mb-8 text-sm leading-relaxed">
              {isLogin
                ? 'Para mantenerte conectado, inicia sesion con tus datos personales'
                : 'Registrate para empezar a gestionar tus compras y tesoreria'
              }
            </p>
            <button
              type="button"
              onClick={toggleMode}
              className="px-8 py-3 border-2 border-white rounded-full text-sm font-semibold
                         hover:bg-white hover:text-brand-700 transition-colors duration-300
                         uppercase tracking-wider"
            >
              {isLogin ? 'Crear cuenta' : 'Iniciar sesion'}
            </button>
          </div>

          {/* Circulos decorativos */}
          <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-brand-500/20 rounded-full" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-400/15 rounded-full" />
        </div>

        {/* Formulario de Login */}
        <div
          className={`
            w-1/2 flex flex-col items-center justify-center p-10
            transition-all duration-700 ease-in-out
            ${isLogin ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none absolute'}
          `}
        >
          <h1 className="text-2xl font-bold text-text-primary mb-2">Iniciar Sesion</h1>
          <p className="text-text-secondary text-sm mb-8">Ingresa tus credenciales</p>

          <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
            <input
              type="email"
              placeholder="Correo electronico"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-surface-alt border border-border rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-brand-400
                         focus:border-transparent transition-all placeholder:text-text-muted"
            />
            <input
              type="password"
              placeholder="Contrasena"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 bg-surface-alt border border-border rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-brand-400
                         focus:border-transparent transition-all placeholder:text-text-muted"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-600 text-white rounded-lg font-semibold text-sm
                         hover:bg-brand-700 active:bg-brand-800 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {mensaje && (
            <p className="mt-4 text-sm text-center text-red-500 max-w-xs">{mensaje}</p>
          )}

          {/* Boton mobile toggle */}
          <button
            type="button"
            onClick={toggleMode}
            className="mt-6 text-sm text-brand-600 hover:text-brand-800 md:hidden"
          >
            No tienes cuenta? Registrate
          </button>
        </div>

        {/* Formulario de Registro */}
        <div
          className={`
            w-1/2 flex flex-col items-center justify-center p-10
            transition-all duration-700 ease-in-out
            ${!isLogin ? 'opacity-100 translate-x-full' : 'opacity-0 translate-x-full pointer-events-none absolute right-0'}
          `}
        >
          <h1 className="text-2xl font-bold text-text-primary mb-2">Crear Cuenta</h1>
          <p className="text-text-secondary text-sm mb-8">Completa tus datos</p>

          <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
            <input
              type="text"
              placeholder="Nombre completo"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              required
              className="w-full px-4 py-3 bg-surface-alt border border-border rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-brand-400
                         focus:border-transparent transition-all placeholder:text-text-muted"
            />
            <input
              type="email"
              placeholder="Correo electronico"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-surface-alt border border-border rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-brand-400
                         focus:border-transparent transition-all placeholder:text-text-muted"
            />
            <input
              type="password"
              placeholder="Contrasena (min 6 caracteres)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 bg-surface-alt border border-border rounded-lg
                         text-sm focus:outline-none focus:ring-2 focus:ring-brand-400
                         focus:border-transparent transition-all placeholder:text-text-muted"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-600 text-white rounded-lg font-semibold text-sm
                         hover:bg-brand-700 active:bg-brand-800 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
            >
              {loading ? 'Registrando...' : 'Registrarse'}
            </button>
          </form>

          {mensaje && (
            <p className={`mt-4 text-sm text-center max-w-xs ${
              mensaje.includes('exitoso') ? 'text-green-600' : 'text-red-500'
            }`}>{mensaje}</p>
          )}

          <button
            type="button"
            onClick={toggleMode}
            className="mt-6 text-sm text-brand-600 hover:text-brand-800 md:hidden"
          >
            Ya tienes cuenta? Inicia sesion
          </button>
        </div>

      </div>
    </div>
  );
}

export default AuthPage;
