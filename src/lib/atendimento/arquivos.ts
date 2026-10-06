/**
 * Arquivos das conversas (fotos, PDFs, áudios) no Supabase Storage, bucket
 * PRIVADO `conversas`. O banco guarda só o caminho; o painel mostra por link
 * assinado que expira (ninguém de fora acessa a foto de um pedido pela URL).
 */
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "conversas";
export const TAMANHO_MAX_BYTES = 15 * 1024 * 1024; // limite prático do WhatsApp para documentos

const EXT_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

function extensao(mime: string, nome?: string | null): string {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  if (EXT_POR_MIME[base]) return EXT_POR_MIME[base];
  const doNome = nome?.split(".").pop()?.toLowerCase();
  if (doNome && /^[a-z0-9]{1,5}$/.test(doNome)) return doNome;
  return "bin";
}

/** Salva o arquivo e devolve o caminho no bucket (ou null se falhar). */
export async function salvarArquivo(
  conteudo: Buffer,
  mime: string,
  nomeOriginal?: string | null,
): Promise<string | null> {
  try {
    if (!conteudo.length || conteudo.length > TAMANHO_MAX_BYTES) return null;
    const agora = new Date();
    const pasta = `${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
    const caminho = `${pasta}/${crypto.randomUUID()}.${extensao(mime, nomeOriginal)}`;
    const { error } = await createAdminClient()
      .storage.from(BUCKET)
      .upload(caminho, conteudo, { contentType: mime || "application/octet-stream", upsert: false });
    if (error) {
      console.warn("[arquivos] upload falhou:", error.message);
      return null;
    }
    return caminho;
  } catch (e) {
    console.warn("[arquivos] erro:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Links assinados (1 hora) para vários caminhos de uma vez. */
export async function linksAssinados(caminhos: string[]): Promise<Record<string, string>> {
  const unicos = [...new Set(caminhos.filter(Boolean))];
  if (!unicos.length) return {};
  try {
    const { data } = await createAdminClient()
      .storage.from(BUCKET)
      .createSignedUrls(unicos, 3600);
    const out: Record<string, string> = {};
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
    }
    return out;
  } catch {
    return {};
  }
}

export function tipoPorMime(mime: string): "imagem" | "video" | "audio" | "arquivo" {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "imagem";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "arquivo";
}
