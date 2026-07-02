/**
 * Helper compartilhado pra enviar mensagem da IA com qualquer tipo de
 * midia (texto/audio/imagem/video). Usado por todos os workers:
 * follow-up, retomada, lembretes, reativacao, pos-venda.
 *
 * Faz TTS se for audio, baixa+envia anexo se for imagem/video, ou envia
 * texto direto. Sempre tem fallback texto se midia falhar.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarMensagem,
  enviarMensagemComAnexoUrl,
  enviarMensagemComAudio,
} from "@/lib/caio/chatwoot-api";
import { gerarAudio } from "@/lib/caio/elevenlabs";
import { personaDoLead } from "@/lib/caio/numeros";

export type TipoMidia = "texto" | "audio" | "imagem" | "video";

export async function enviarComMidia(opts: {
  conversationId: number;
  organizationId: string;
  texto: string;
  tipoMidia: TipoMidia;
  attachmentUrl: string | null;
  attachmentMime: string | null;
}): Promise<{ id?: number } | { error: string }> {
  const { conversationId, organizationId, texto } = opts;
  const tipoMidia = opts.tipoMidia ?? "texto";

  if (tipoMidia === "audio") {
    const supabase = createAdminClient();
    // Voz do NÚMERO que serve o lead (persona_voice_id); fallback voz da org.
    const { data: leadV } = await supabase
      .from("leads")
      .select("evolution_instance")
      .eq("chatwoot_conversation_id", conversationId)
      .limit(1);
    const personaV = await personaDoLead(
      (leadV?.[0] as { evolution_instance?: string | null } | undefined)?.evolution_instance ?? null,
    );
    const { data: orgVoz } = await supabase
      .from("organizations")
      .select("voice_id, voice_settings")
      .eq("id", organizationId)
      .single();
    const tts = await gerarAudio({
      texto,
      voiceId: personaV?.persona_voice_id || orgVoz?.voice_id || undefined,
      voiceSettings: orgVoz?.voice_settings ?? null,
    });
    if ("error" in tts) {
      console.warn("[midia:audio]", "TTS falhou, fallback texto:", tts.error);
      return enviarMensagem({ conversationId, content: texto });
    }
    const sent = await enviarMensagemComAudio({
      conversationId,
      audio: tts.audio,
      filename: "msg.mp3",
      mimeType: tts.mimeType,
      content: texto, // persiste o texto falado pra auditoria no painel (áudio sem legenda some do histórico)
    });
    if ("error" in sent) {
      console.warn(
        "[midia:audio]",
        "envio audio falhou, fallback texto:",
        sent.error,
      );
      return enviarMensagem({ conversationId, content: texto });
    }
    return sent;
  }

  if (
    (tipoMidia === "imagem" || tipoMidia === "video") &&
    opts.attachmentUrl &&
    opts.attachmentMime
  ) {
    const sent = await enviarMensagemComAnexoUrl({
      conversationId,
      url: opts.attachmentUrl,
      mimeType: opts.attachmentMime,
      caption: texto,
    });
    if ("error" in sent) {
      console.warn(
        "[midia:anexo]",
        "envio anexo falhou, fallback texto:",
        sent.error,
      );
      return enviarMensagem({ conversationId, content: texto });
    }
    return sent;
  }

  return enviarMensagem({ conversationId, content: texto });
}
