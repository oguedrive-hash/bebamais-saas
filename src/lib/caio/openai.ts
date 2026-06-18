/**
 * Cliente OpenAI minimalista via fetch direto.
 * Sem dependência do SDK oficial — menos peso e mais controle.
 *
 * Server-side only (usa OPENAI_API_KEY do .env).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
};

export type ChatResult =
  | { content: string; usage?: { input: number; output: number } }
  | { error: string };

/**
 * Transcreve áudio via Whisper.
 * Baixa o arquivo da URL, envia pra /v1/audio/transcriptions e devolve
 * o texto. Modelo configurável via OPENAI_WHISPER_MODEL (default whisper-1).
 */
export async function transcreverAudio(opts: {
  audioUrl: string;
}): Promise<{ texto: string } | { error: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: "OPENAI_API_KEY não definida" };
  const model = process.env.OPENAI_WHISPER_MODEL ?? "whisper-1";

  try {
    // Baixa o áudio
    const audioRes = await fetch(opts.audioUrl);
    if (!audioRes.ok) {
      return {
        error: `Falha ao baixar áudio (${audioRes.status})`,
      };
    }
    const blob = await audioRes.blob();

    // Whisper precisa de filename — extrai da URL ou usa fallback
    const urlPath = new URL(opts.audioUrl).pathname;
    const filename = urlPath.split("/").pop() || "audio.ogg";
    const file = new File([blob], filename, {
      type: blob.type || "audio/ogg",
    });

    const form = new FormData();
    form.set("file", file);
    form.set("model", model);
    form.set("language", "pt"); // força português (lead BR)

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        error: `Whisper ${res.status}: ${text.slice(0, 300)}`,
      };
    }

    const data = (await res.json()) as { text?: string };
    if (!data.text) return { error: "Whisper devolveu resposta vazia" };
    return { texto: data.text.trim() };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

/**
 * Chama o endpoint /v1/chat/completions da OpenAI com retry automático.
 *
 * Erros transitórios (network, timeout, 5xx, 429) são retried com backoff
 * exponencial: 1s, 2s, 4s. Erros permanentes (4xx exceto 429) falham
 * imediatamente — não adianta tentar de novo.
 *
 * Retorna conteúdo da primeira choice ou { error }.
 */
export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: "OPENAI_API_KEY não definida" };

  const model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const MAX_TENTATIVAS = 3;
  const BACKOFF_MS = [1000, 2000, 4000];

  let ultimoErro = "";
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    if (tentativa > 0) {
      console.log(
        `[openai] retry ${tentativa}/${MAX_TENTATIVAS - 1} em ${BACKOFF_MS[tentativa - 1]}ms (último erro: ${ultimoErro.slice(0, 100)})`,
      );
      await new Promise((r) => setTimeout(r, BACKOFF_MS[tentativa - 1]));
    }

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.7,
          ...(opts.max_tokens ? { max_tokens: opts.max_tokens } : {}),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        ultimoErro = `OpenAI ${res.status}: ${text.slice(0, 300)}`;
        // 429 (rate limit) e 5xx (servidor) são transitórios — retry.
        // 4xx (exceto 429) são permanentes — desiste imediatamente.
        if (res.status !== 429 && res.status < 500) {
          return { error: ultimoErro };
        }
        continue;
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        ultimoErro = "Resposta OpenAI sem content";
        continue;
      }

      return {
        content,
        usage: data.usage
          ? {
              input: data.usage.prompt_tokens,
              output: data.usage.completion_tokens,
            }
          : undefined,
      };
    } catch (err) {
      // Network/timeout/etc — sempre transitório, retry
      ultimoErro = err instanceof Error ? err.message : "fetch failed";
    }
  }

  return { error: `${ultimoErro} (após ${MAX_TENTATIVAS} tentativas)` };
}
