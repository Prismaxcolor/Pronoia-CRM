/** Passkey (credencial WebAuthn) de un usuario, tal como se muestra en su perfil. */
export interface PasskeyResumen {
  id: string;
  nombre: string;
  creadoEn: string;
  ultimoUso: string | null;
}
