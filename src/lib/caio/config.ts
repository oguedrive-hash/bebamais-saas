/**
 * Config do TENANT (o cliente dono deste deploy). TUDO que é específico de um
 * cliente vem daqui, lido de env — SEM fallback pros valores da Facilita.
 *
 * Por quê: cada clone roda numa VPS própria com env próprio. Se o código tivesse
 * `?? "<valor da Facilita>"` e o clone esquecesse de setar a env, ele escreveria
 * SILENCIOSAMENTE no org/WhatsApp/URL da Facilita (vazamento cross-tenant). Aqui
 * o fallback é "" e o `assertTenantConfig()` barra com erro claro. Ver
 * `.env.cliente.template` pro contrato completo de env.
 */

/** UUID da organization deste tenant (tabela `organizations`). */
export const ORG_ID = process.env.DEFAULT_ORG_ID?.trim() ?? "";

/** Nome da instância Evolution que atende os leads deste tenant (ex: "facilita"). */
export const INSTANCE_NAME = process.env.DEFAULT_INSTANCE_NAME?.trim() ?? "";

/** URL pública do painel deste tenant (pra links em notificações). Sem barra final. */
export const APP_BASE_URL = (process.env.APP_BASE_URL?.trim() ?? "").replace(
  /\/+$/,
  "",
);

/** WhatsApp do admin pra alertas (opcional — sem ele, alertas só são pulados). */
export const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP_NUMBER?.trim() ?? "";

/**
 * Garante que as envs client-specific OBRIGATÓRIAS estão setadas. Chamar no
 * início dos entrypoints (webhook, crons) pra um clone mal-configurado falhar
 * com erro claro em vez de vazar pro tenant errado.
 */
export function assertTenantConfig(): void {
  const faltando = (
    [
      ["DEFAULT_ORG_ID", ORG_ID],
      ["DEFAULT_INSTANCE_NAME", INSTANCE_NAME],
      ["APP_BASE_URL", APP_BASE_URL],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (faltando.length) {
    throw new Error(
      `[config] env(s) obrigatória(s) do tenant ausente(s): ${faltando.join(", ")}. ` +
        `Cada clone precisa setar as suas (ver .env.cliente.template).`,
    );
  }
}
