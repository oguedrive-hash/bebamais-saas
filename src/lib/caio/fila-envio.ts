/**
 * Fila de envio serializada por organização (in-process).
 *
 * Garante que, para um mesmo número/org, as mensagens saem UMA POR VEZ e com
 * um intervalo humanizado entre elas (5–10s) — evita rajada sincronizada, que
 * o WhatsApp pode marcar como automação. Orgs diferentes têm filas
 * independentes: uma nunca segura a outra.
 *
 * In-memory de propósito: o painel roda em instância única e persistente, então
 * dispensa Redis. Se um dia virar multi-réplica, migrar pra lock distribuído.
 */

const INTERVALO_BASE_MS = 5000; // 5s fixos
const INTERVALO_JITTER_MS = 5000; // + 0..5s aleatório → 5–10s entre envios

const cadeiaPorOrg = new Map<string, Promise<unknown>>();
const ultimoEnvioMs = new Map<string, number>();

export async function enviarSerializado<T>(
  chaveOrg: string,
  envio: () => Promise<T>,
): Promise<T> {
  const chave = chaveOrg || "_sem_org_";
  const anterior = cadeiaPorOrg.get(chave) ?? Promise.resolve();
  const minhaVez = anterior
    .catch(() => {}) // erro de um envio não derruba a fila dos próximos
    .then(async () => {
      const ultimo = ultimoEnvioMs.get(chave) ?? 0;
      const intervalo =
        INTERVALO_BASE_MS + Math.floor(Math.random() * INTERVALO_JITTER_MS);
      const esperar = ultimo + intervalo - Date.now();
      if (esperar > 0) await new Promise((r) => setTimeout(r, esperar));
      try {
        return await envio();
      } finally {
        ultimoEnvioMs.set(chave, Date.now());
      }
    });
  cadeiaPorOrg.set(chave, minhaVez);
  return minhaVez;
}
