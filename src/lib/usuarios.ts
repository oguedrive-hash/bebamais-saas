/**
 * Usuário↔e-mail sintético: o painel loga por USUÁRIO/senha (pedido do
 * cliente — a equipe não usa e-mail), mas o Supabase Auth só conhece e-mail.
 * Convenção: "maria" ↔ "maria@usuarios.bebamais.local". Contas antigas com
 * e-mail real continuam funcionando (o login aceita os dois formatos).
 */

export const DOMINIO_USUARIOS = "usuarios.bebamais.local";

const RE_USUARIO = /^[a-z0-9][a-z0-9._-]{1,29}$/;

/** Normaliza o que a pessoa digitou: minúsculo, sem acento, sem espaços. */
export function normalizarUsuario(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, ".");
}

/** Valida o formato (2-30 chars: letras, números, ponto, hífen, underscore). */
export function usuarioValido(usuario: string): boolean {
  return RE_USUARIO.test(usuario);
}

export function usuarioParaEmail(raw: string): string | null {
  const u = normalizarUsuario(raw);
  if (!usuarioValido(u)) return null;
  return `${u}@${DOMINIO_USUARIOS}`;
}

/** E-mail sintético → usuário; e-mail real → null (mostra o e-mail mesmo). */
export function emailParaUsuario(email: string | null): string | null {
  if (!email) return null;
  const suf = `@${DOMINIO_USUARIOS}`;
  return email.endsWith(suf) ? email.slice(0, -suf.length) : null;
}
