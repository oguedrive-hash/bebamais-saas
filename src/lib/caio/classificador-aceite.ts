/**
 * Classifica se a última mensagem do lead indica aceite (ou rejeição) de
 * marcar a retirada proposta pelo Caio. Quatro intenções possíveis:
 *
 *  - aceita_sem_horario   — sim, mas não diz quando (Caio vai propor slots)
 *  - aceita_com_horario   — sim E indica momento (Caio cria agendamento)
 *  - nao_aceita           — não quer marcar agora
 *  - responde_normal      — assunto da msg é outro (segue fluxo normal)
 *
 * Roda DEPOIS do classificador de adiamento — se adiamento já tratou, esse
 * nem é chamado. Usa gpt-4o-mini com prompt curto e zero temperatura.
 */

import { chatCompletion } from "./openai";

export type ResultadoAceite =
  | { intencao: "responde_normal" }
  | { intencao: "nao_aceita" }
  | { intencao: "aceita_sem_horario" }
  | { intencao: "aceita_com_horario"; momento_iso: string };

const SYSTEM_PROMPT = `Você é um classificador. O Caio (atendente da Beba Mais) propôs ou está propondo agendar uma RETIRADA DE PEDIDO com o lead. Você recebe a mensagem mais recente do lead e o contexto da conversa. Classifica a INTENÇÃO em UMA das opções:

1. "aceita_sem_horario" — lead concorda em marcar a retirada, mas NÃO indica dia/hora. Ex: "pode ser", "vamos lá", "fechado", "topo", "bora marcar", "qual o melhor horário?", "tu tem disponibilidade quando?", "manda os horários".

2. "aceita_com_horario" — lead concorda em marcar E indica uma HORA ESPECIFICA (HH:MM ou HHh). Ex: "amanhã às 14h pode ser", "fechado pra 15h", "dia 5/6 às 10h", "pode ser amanhã às 9:30". Hora especifica eh obrigatorio aqui.

3. "nao_aceita" — lead recusa marcar retirada agora. Ex: "não tenho interesse", "outra hora", "deixa pra lá", "agora não", "obrigado mas não preciso".

4. "responde_normal" — qualquer outra coisa. Lead conversa, faz pergunta sobre serviço, pede detalhe, agradece, etc. Inclui mensagens de saudação inicial.

REGRAS:
- Se a conversa NÃO trata de marcar retirada de pedido, classifica como "responde_normal".
- Se o Caio acabou de propor agendar (na msg anterior) e o lead responde positivamente sem horário → "aceita_sem_horario".
- Se duvidoso entre "aceita_sem_horario" e "responde_normal", prefira "responde_normal".
- "aceita_com_horario" EXIGE hora especifica explicita (ex: "14h", "09:30", "às 10"). APENAS turno ("tarde", "manhã", "noite") ou apenas dia ("segunda", "amanhã") NAO conta como hora especifica — classifica como "aceita_sem_horario".
- Para "aceita_com_horario", retorne "momento_iso" no formato ISO 8601 com fuso America/Sao_Paulo (UTC-3). Use "hoje" do contexto pra resolver datas relativas.
- "às 14h" sem AM/PM = 14:00. NAO invente hora — se nao tem hora explicita, vai pra "aceita_sem_horario".

Retorne APENAS JSON, sem markdown:
{"intencao": "responde_normal"} OU
{"intencao": "nao_aceita"} OU
{"intencao": "aceita_sem_horario"} OU
{"intencao": "aceita_com_horario", "momento_iso": "2026-06-05T14:00:00-03:00"}`;

export async function classificarAceite(opts: {
  ultimaMensagem: string;
  contextoAnterior: string;
}): Promise<ResultadoAceite> {
  if (!opts.ultimaMensagem?.trim()) {
    return { intencao: "responde_normal" };
  }

  // Constrói contexto temporal explícito: data + dia da semana de hoje +
  // mapa dos próximos 7 dias por nome. Sem isso o LLM erra coisas como
  // "próxima segunda" — não dá pra confiar que ele saiba o calendário.
  const agora = new Date();
  const hojeStr = agora.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const proximosDias: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(agora.getTime() + i * 86400 * 1000);
    const label = d.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
    });
    const iso = d
      .toLocaleString("sv-SE", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .slice(0, 10);
    proximosDias.push(`  ${label} → ${iso}`);
  }
  const userPrompt = `Hoje agora: ${hojeStr} (fuso America/Sao_Paulo)

Próximos 8 dias (pra você resolver "amanhã", "segunda", "próxima quarta", etc):
${proximosDias.join("\n")}

REGRA: se o lead disser um nome de dia da semana (ex: "segunda", "terça"), use o ISO da PRÓXIMA ocorrência desse dia da lista acima. NUNCA misture o nome do dia com uma data diferente.

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
    console.warn("[classificador:aceite] erro:", result.error);
    return { intencao: "responde_normal" };
  }

  try {
    const limpo = result.content.trim().replace(/^```json\n?|```$/g, "");
    const parsed = JSON.parse(limpo) as ResultadoAceite;
    if (
      parsed.intencao === "responde_normal" ||
      parsed.intencao === "nao_aceita" ||
      parsed.intencao === "aceita_sem_horario"
    ) {
      return parsed;
    }
    if (parsed.intencao === "aceita_com_horario" && parsed.momento_iso) {
      const m = new Date(parsed.momento_iso);
      if (Number.isNaN(m.getTime())) {
        return { intencao: "responde_normal" };
      }
      // Data no passado: IA errou — descarta
      if (m.getTime() < Date.now() - 60 * 60 * 1000) {
        return { intencao: "responde_normal" };
      }
      console.log(
        "[classificador:aceite] momento detectado:",
        parsed.momento_iso,
      );
      return { intencao: "aceita_com_horario", momento_iso: parsed.momento_iso };
    }
  } catch (err) {
    console.warn(
      "[classificador:aceite] parse falhou:",
      err,
      result.content,
    );
  }
  return { intencao: "responde_normal" };
}
