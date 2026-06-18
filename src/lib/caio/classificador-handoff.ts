/**
 * Classifica se a ultima msg do lead exige handoff pra humano:
 * - "muda_reuniao": quer reagendar ou cancelar reuniao ja marcada
 * - "irritado": sinais claros de raiva, frustracao, xingamento
 * - "pede_humano": pede explicitamente falar com pessoa/atendente/gerente
 * - "nenhum": fluxo normal
 *
 * Chamado ANTES do classificador de aceite/adiamento no webhook.
 */

import { chatCompletion } from "./openai";

export type MotivoHandoff = "muda_reuniao" | "irritado" | "pede_humano";

export type ResultadoHandoff =
  | { intencao: "nenhum" }
  | { intencao: MotivoHandoff };

const SYSTEM_PROMPT = `Voce e um classificador de UMA mensagem de um lead num atendimento WhatsApp. Classifica em UMA dessas opcoes:

1. "muda_reuniao" — lead pede pra REAGENDAR, REMARCAR, TROCAR HORARIO ou CANCELAR uma reuniao/consultoria. Ex: "da pra reagendar?", "preciso cancelar a reuniao", "trocar pra outro dia", "nao vou conseguir amanha".

2. "irritado" — lead claramente irritado/ofensivo COM O ATENDIMENTO OU COM A FACILITA, xingando, reclamando do servico, perdendo a paciencia COM VOCE. Ex: "que merda esse atendimento", "voces sao um lixo", "to perdendo MEU TEMPO com voces", "porra nenhuma funciona aqui".

ATENCAO — NAO eh "irritado" quando lead apenas:
- Compartilha dor da propria operacao: "perdemos muito lead", "to com problemas no comercial", "ta dificil esse mes". Isso eh CONTEXTO, nao raiva contra voce.
- Reclama de outras coisas que nao sao voce/Facilita: "esse mercado ta dificil", "concorrencia ta apertada".
- Usa palavroes leves de enfase ("porra ne", "ta foda esse trafego") sem agressao direcionada.
Frustracao leve, desabafo, partilha de problema: classifica "nenhum".

3. "pede_humano" — lead pede EXPLICITAMENTE pra ser TRANSFERIDO/FALAR com uma pessoa/humano/atendente/vendedor/gerente/responsavel. Ex: "quero falar com uma pessoa", "me passa pro humano", "passa pro atendente", "quero falar com o responsavel", "chama alguem ai".

ATENCAO — NAO eh "pede_humano" se:
- Lead apenas PERGUNTA se voce eh humano/bot/IA ("voce eh humano?", "eh bot?", "eh IA?", "vc eh real?"). Isso eh curiosidade, classifica "nenhum".
- Lead diz "ah humano demais kkk" ou comenta sobre humanidade sem pedir transferencia.

4. "nenhum" — qualquer outra coisa. Conversa normal, pergunta sobre produto, agradece, pergunta se voce eh humano/bot, etc.

REGRAS:
- Se duvidoso, classifica "nenhum".
- "muda_reuniao" so se a reuniao ja existir no contexto (lead esta confirmando, perguntando se da pra mudar, etc).
- Frustracao leve ("ah ta", "hum...", "to ocupado") NAO eh "irritado".
- "voce eh humano?" / "eh bot?" / "eh IA?" NUNCA eh "pede_humano" — eh curiosidade, classifica "nenhum".

Retorne APENAS JSON valido, sem markdown:
{"intencao": "nenhum"} OU
{"intencao": "muda_reuniao"} OU
{"intencao": "irritado"} OU
{"intencao": "pede_humano"}`;

export async function classificarHandoff(opts: {
  ultimaMensagem: string;
  contextoAnterior: string;
}): Promise<ResultadoHandoff> {
  const result = await chatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Contexto anterior:\n${opts.contextoAnterior}\n\nMensagem atual do lead:\n${opts.ultimaMensagem}`,
      },
    ],
    temperature: 0,
    max_tokens: 30,
  });

  if ("error" in result) {
    console.warn("[classificador-handoff] erro:", result.error);
    return { intencao: "nenhum" };
  }

  try {
    const limpo = result.content.trim().replace(/^```json\n?|```$/g, "");
    const parsed = JSON.parse(limpo) as ResultadoHandoff;
    if (
      parsed.intencao === "nenhum" ||
      parsed.intencao === "muda_reuniao" ||
      parsed.intencao === "irritado" ||
      parsed.intencao === "pede_humano"
    ) {
      return parsed;
    }
  } catch (err) {
    console.warn("[classificador-handoff] parse falhou:", err, result.content);
  }
  return { intencao: "nenhum" };
}
