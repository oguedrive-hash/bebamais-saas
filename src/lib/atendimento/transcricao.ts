/**
 * Transcrição de áudio com o Whisper. Usada no atendimento (o texto vai para o
 * histórico e para o assistente) e no Aprendizado (áudio da equipe vira texto).
 */
export async function transcrever(base64: string, mime: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const form = new FormData();
    form.set("file", new File([Buffer.from(base64, "base64")], "audio.ogg", { type: mime || "audio/ogg" }));
    form.set("model", process.env.OPENAI_WHISPER_MODEL ?? "whisper-1");
    form.set("language", "pt");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}
