/**
 * Classifica se a ultima mensagem do lead indica que ele quer:
 * - adiar a conversa pra outro momento (sem especificar quando)
 * - informar quando pode ser contatado (responde a uma pergunta anterior)
 * - ja pede com data especifica
 *
 * Faz uma chamada barata ao gpt-4o-mini com prompt curto. Retorna json
 * estruturado pra fluxo no webhook.
 */

import { chatCompletion } from "./openai";

export type ResultadoClassificacao =
  | { intencao: "responde_normal" }
  | { intencao: "pede_adiamento_sem_data" }
  | { intencao: "informa_data"; momento_iso: string };

const SYSTEM_PROMPT = `Você é um classificador. Recebe uma mensagem recente de um lead e o contexto da conversa anterior. Classifica a INTENÇÃO em UMA dessas opções:

1. "pede_adiamento_sem_data" — lead pede pra falar outro momento mas SEM nenhuma referência temporal computável. Ex: "me chama outro dia", "tô sem tempo agora", "depois", "to atolado", "qualquer hora", "mais pra frente". Se houver QUALQUER prazo ou quantidade ("daqui X", "em X", "semana que vem", "amanhã"), NÃO é esta — é "informa_data".

2. "informa_data" — lead indica QUANDO pode ser contatado, seja respondendo a uma pergunta OU já pedindo o adiamento com um prazo computável. Inclui: datas/horários ("amanhã às 14h", "segunda de manhã", "dia 5/6", "depois do almoço") E deslocamentos relativos ("me chama daqui 3 semanas", "em 10 minutos", "daqui 2 dias", "mês que vem", "semana que vem"). Frases curtas tipo "amanhã" ou "às 15h" também contam.

3. "responde_normal" — qualquer outra coisa. Lead conversa, pergunta, responde algo da conversa, agradece, etc.

REGRAS:
- Se duvidoso, classifica como "responde_normal"
- Se for "informa_data", você DEVE retornar o campo "momento_iso" com a data/hora em formato ISO 8601 no fuso America/Sao_Paulo (UTC-3). Hoje é a data de referência fornecida no contexto.
- Para datas relativas ("amanhã", "segunda"), calcula em relação ao "hoje" fornecido.
- Deslocamentos relativos ("daqui X minutos/horas/dias/semanas/meses", "em X ...", "semana/mês que vem") → SOMA ao "hoje" e devolve "informa_data" com o momento_iso. Isso vale MESMO quando o lead está PEDINDO o adiamento (não só respondendo a uma pergunta). Ex: hoje 2026-06-22 + "daqui 3 semanas" → "2026-07-13T14:00:00-03:00"; "em 10 minutos" → soma 10 min ao horário atual.
- Para horários sem AM/PM em mensagem comercial, assume horário comercial: manhã=09:00, tarde=14:00, noite=19:00.
- Se faltar hora, assume 14:00.

Retorne APENAS um JSON válido, sem markdown, sem explicação, no formato:
{"intencao": "responde_normal"} OU
{"intencao": "pede_adiamento_sem_data"} OU
{"intencao": "informa_data", "momento_iso": "2026-06-05T14:00:00-03:00"}`;

export async function classificarAdiamento(opts: {
  ultimaMensagem: string;
  contextoAnterior: string;
  aguardandoResposta: boolean;
}): Promise<ResultadoClassificacao> {
  const hoje = new Date();
  const hojeStr = hoje.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const userPrompt = `Hoje: ${hojeStr} (America/Sao_Paulo)
${opts.aguardandoResposta ? "[ATENÇÃO: o sistema PERGUNTOU ao lead quando podia ser contatado. A msg dele agora provavelmente é a resposta — favoreça classificar como informa_data se houver QUALQUER referência temporal]" : ""}

Contexto anterior (últimas msgs):
${opts.contextoAnterior}

Mensagem atual do lead:
${opts.ultimaMensagem}`;

  const result = await chatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: 100,
  });

  if ("error" in result) {
    console.warn("[classificador] erro:", result.error);
    return { intencao: "responde_normal" };
  }

  try {
    const limpo = result.content.trim().replace(/^```json\n?|```$/g, "");
    const parsed = JSON.parse(limpo) as ResultadoClassificacao;
    if (
      parsed.intencao === "responde_normal" ||
      parsed.intencao === "pede_adiamento_sem_data"
    ) {
      return parsed;
    }
    if (parsed.intencao === "informa_data" && parsed.momento_iso) {
      // Valida que é uma data válida e no futuro
      const m = new Date(parsed.momento_iso);
      if (Number.isNaN(m.getTime())) {
        return { intencao: "responde_normal" };
      }
      // Se data está no passado (IA errou), fallback
      if (m.getTime() < Date.now() - 60 * 60 * 1000) {
        return { intencao: "responde_normal" };
      }
      return { intencao: "informa_data", momento_iso: parsed.momento_iso };
    }
  } catch (err) {
    console.warn("[classificador] parse falhou:", err, result.content);
  }
  return { intencao: "responde_normal" };
}
