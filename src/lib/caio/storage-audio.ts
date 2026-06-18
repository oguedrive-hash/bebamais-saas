/**
 * Salva áudio (base64) no Supabase Storage e devolve a URL pública, pra o
 * painel poder TOCAR o áudio (campo attachment_url da mensagem). Reusa o bucket
 * `followup-anexos` (público). Fire-safe: se falhar, devolve null e o fluxo
 * segue só com a transcrição (não derruba o envio/recebimento).
 *
 * Necessário porque, na migração Chatwoot→Evolution, o áudio passou a ser só
 * transcrito (Whisper) e o arquivo era descartado — daí o player sumir do painel.
 */
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "followup-anexos";

export async function salvarAudioBase64(
  base64: string,
  ext: "ogg" | "mp3" = "ogg",
  contentType = "audio/ogg",
): Promise<string | null> {
  try {
    if (!base64) return null;
    const admin = createAdminClient();
    const nome = `caio-audio/${crypto.randomUUID()}.${ext}`;
    const buf = Buffer.from(base64, "base64");
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(nome, buf, { contentType, cacheControl: "31536000", upsert: false });
    if (error) {
      console.warn("[storage-audio] upload falhou:", error.message);
      return null;
    }
    const { data } = admin.storage.from(BUCKET).getPublicUrl(nome);
    return data.publicUrl;
  } catch (e) {
    console.warn("[storage-audio] erro:", e instanceof Error ? e.message : e);
    return null;
  }
}
