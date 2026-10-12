import { timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante. Falha fechado: se o esperado não
 * estiver configurado, NUNCA confere (melhor recusar tudo do que aceitar tudo).
 */
export function segredoConfere(
  recebido: string | null | undefined,
  esperado: string | null | undefined,
): boolean {
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Header `Authorization: Bearer <CRON_SECRET>` das rotinas automáticas. */
export function cronAutorizado(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  return segredoConfere(authorization.slice(7), secret);
}

/** Token do webhook da Evolution (vai na URL: /api/webhooks/evolution?token=...). */
export function webhookAutorizado(token: string | null): boolean {
  return segredoConfere(token, process.env.WEBHOOK_SECRET?.trim());
}
