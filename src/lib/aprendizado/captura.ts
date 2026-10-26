import { createAdminClient } from "@/lib/supabase/admin";
import { evoBuscarMensagens } from "@/lib/caio/evolution-admin";
import { evoBaixarMidia } from "@/lib/caio/evolution-api";
import { normalizarMensagem, type EvoKey } from "@/lib/atendimento/inbound";
import { transcrever } from "@/lib/atendimento/transcricao";

/**
 * APRENDIZADO — captura das conversas reais da equipe (mesmo modelo da iBrasileira).
 *
 * O WhatsApp de maior movimento da loja é conectado como uma instância à
 * parte, com nome começando por `aprendizado_`. Ela fica FORA de `org_numeros`
 * de propósito: assim nunca vira número de atendimento e o assistente nunca
 * responde por ela. O webhook desvia essa instância logo na entrada (ver
 * api/webhooks/evolution/route.ts).
 *
 * Tudo que entra (cliente) e sai (equipe) é copiado para
 * `aprendizado_mensagens`. Grupo, status e canal ficam de fora; contato em
 * `aprendizado_excluidos` também.
 */

export const PREFIXO_INSTANCIA = "aprendizado_";

export function ehInstanciaAprendizado(instance: string | null | undefined): boolean {
  return !!instance && instance.startsWith(PREFIXO_INSTANCIA);
}

export type MensagemEvo = {
  key?: EvoKey;
  pushName?: string | null;
  messageType?: string;
  messageTimestamp?: number | string | { low?: number } | null;
  message?: Record<string, unknown> | null;
};

export type LinhaAprendizado = {
  organization_id: string;
  instance_name: string;
  msg_id: string;
  conversa_jid: string;
  telefone: string | null;
  nome_contato: string | null;
  direcao: "cliente" | "equipe";
  tipo: string;
  conteudo: string | null;
  enviada_em: string;
  origem: "ao_vivo" | "historico";
};

/** Conversa que não é atendimento: grupo, status, canal, transmissão. */
function ehConversaIgnorada(jid: string): boolean {
  return (
    !jid ||
    jid.endsWith("@g.us") ||
    jid.endsWith("@broadcast") ||
    jid.endsWith("@newsletter") ||
    jid === "status@broadcast"
  );
}

function quando(ts: MensagemEvo["messageTimestamp"]): string {
  const n = typeof ts === "object" && ts !== null ? Number(ts.low ?? 0) : Number(ts ?? 0);
  // Timestamp do WhatsApp vem em segundos; zero/inválido cai no "agora".
  return n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

/** Monta a linha a gravar, ou null quando a mensagem não entra no aprendizado. Função pura (testável). */
export function linhaDaMensagem(
  m: MensagemEvo,
  organizationId: string,
  instance: string,
  origem: LinhaAprendizado["origem"],
): LinhaAprendizado | null {
  const k = m.key ?? {};
  const msgId = k.id;
  const jid = k.remoteJid ?? "";
  if (!msgId || ehConversaIgnorada(jid) || ehConversaIgnorada(k.remoteJidAlt ?? "x")) return null;
  const lido = normalizarMensagem((m.message ?? undefined) as Record<string, unknown> | undefined);
  // Reação, mensagem apagada/editada e figurinha não dizem nada sobre como a equipe atende.
  if (lido.ignorar || lido.texto === "(figurinha)") return null;
  const numeroJid = [jid, k.remoteJidAlt ?? ""].find((j) => j.endsWith("@s.whatsapp.net"));
  const equipe = k.fromMe === true;
  const nome = typeof m.pushName === "string" && m.pushName.trim() ? m.pushName.trim() : null;
  return {
    organization_id: organizationId,
    instance_name: instance,
    msg_id: msgId,
    conversa_jid: jid,
    telefone: numeroJid ? numeroJid.replace(/@.*/, "").replace(/\D/g, "") : null,
    // pushName na mensagem da equipe é o nome da LOJA, não do cliente.
    nome_contato: equipe ? null : nome,
    direcao: equipe ? "equipe" : "cliente",
    tipo: lido.tipo,
    // Foto/arquivo sem legenda fica só com o tipo; o arquivo em si não é guardado.
    conteudo: lido.tipo === "arquivo" ? (lido.texto ?? lido.midia?.nome ?? null) : lido.texto,
    enviada_em: quando(m.messageTimestamp),
    origem,
  };
}

async function excluidos(organizationId: string): Promise<Set<string>> {
  const { data } = await createAdminClient()
    .from("aprendizado_excluidos")
    .select("conversa_jid")
    .eq("organization_id", organizationId);
  return new Set((data ?? []).map((r) => r.conversa_jid));
}

/** Mensagem que chegou agora pelo webhook. Áudio ao vivo é transcrito. */
export async function registrarMensagemAprendizado(
  m: MensagemEvo | undefined,
  organizationId: string,
  instance: string,
): Promise<void> {
  if (!m) return;
  const linha = linhaDaMensagem(m, organizationId, instance, "ao_vivo");
  if (!linha) return;
  if ((await excluidos(organizationId)).has(linha.conversa_jid)) return;

  if (linha.tipo === "audio") {
    const baixado = await evoBaixarMidia(instance, m.key);
    linha.conteudo = baixado ? await transcrever(baixado.base64, baixado.mimetype?.split(";")[0] || "audio/ogg") : null;
  }

  const { error } = await createAdminClient()
    .from("aprendizado_mensagens")
    .upsert(linha, { onConflict: "instance_name,msg_id", ignoreDuplicates: true });
  if (error) console.error("[aprendizado] gravar falhou:", error.message);
}

/**
 * Copia para cá o que a Evolution guardou da instância — inclusive o histórico
 * que o WhatsApp manda ao conectar. Pode rodar quantas vezes quiser: o que já
 * existe é ignorado. Áudio antigo NÃO é transcrito (seria uma fila enorme de
 * Whisper); fica marcado como áudio.
 */
export async function importarHistorico(
  organizationId: string,
  instance: string,
): Promise<{ importadas: number; lidas: number } | { error: string }> {
  const fora = await excluidos(organizationId);
  const admin = createAdminClient();
  let importadas = 0;
  let lidas = 0;
  let paginas = 1;
  // Teto de segurança: 300 páginas de 200 = 60 mil mensagens por rodada.
  for (let pagina = 1; pagina <= paginas && pagina <= 300; pagina++) {
    const r = await evoBuscarMensagens(instance, pagina);
    if ("error" in r) return pagina === 1 ? r : { importadas, lidas };
    paginas = r.paginas;
    lidas += r.registros.length;
    const linhas = (r.registros as MensagemEvo[])
      .map((m) => linhaDaMensagem(m, organizationId, instance, "historico"))
      .filter((l): l is LinhaAprendizado => !!l && !fora.has(l.conversa_jid));
    if (linhas.length > 0) {
      const { error, count } = await admin
        .from("aprendizado_mensagens")
        .upsert(linhas, { onConflict: "instance_name,msg_id", ignoreDuplicates: true, count: "exact" });
      if (error) return { error: error.message };
      importadas += count ?? 0;
    }
    if (r.registros.length === 0) break;
  }
  await admin
    .from("aprendizado_config")
    .update({ historico_importado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId);
  return { importadas, lidas };
}

/** Evento de conexão da instância de aprendizado: atualiza a situação na tela. */
export async function atualizarConexaoAprendizado(
  organizationId: string,
  instance: string,
  estado: string,
  numero?: string | null,
): Promise<void> {
  if (!estado) return;
  const admin = createAdminClient();
  const upd: Record<string, unknown> = { status_conexao: estado, updated_at: new Date().toISOString() };
  if (estado === "open" && numero) upd.numero = numero.replace(/@.*/, "").replace(/\D/g, "");
  await admin.from("aprendizado_config").update(upd).eq("organization_id", organizationId).eq("instance_name", instance);
  // A data de conexão é a da PRIMEIRA vez: as reconexões de toda noite não zeram os "dias captando".
  if (estado === "open") {
    await admin
      .from("aprendizado_config")
      .update({ conectado_em: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("instance_name", instance)
      .is("conectado_em", null);
  }
}
