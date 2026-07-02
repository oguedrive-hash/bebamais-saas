/**
 * Classifica se a ultima msg do lead exige handoff pra humano:
 * - "muda_reuniao": quer reagendar ou cancelar retirada ja marcada
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

1. "muda_reuniao" — lead pede pra REAGENDAR, REMARCAR, TROCAR HORARIO ou CANCELAR uma retirada de pedido. Ex: "da pra reagendar?", "preciso cancelar a retirada", "trocar pra outro dia", "nao vou conseguir amanha".

2. "irritado" — lead claramente irritado/ofensivo COM O ATENDIMENTO OU COM A BEBA MAIS, xingando, reclamando do servico, perdendo a paciencia COM VOCE. Ex: "que merda esse atendimento", "voces sao um lixo", "to perdendo MEU TEMPO com voces", "porra nenhuma funciona aqui".

ATENCAO — NAO eh "irritado" quando lead apenas:
- Compartilha uma dificuldade propria: "meu evento e amanha e to sem bebida", "ta dificil esse mes". Isso eh CONTEXTO, nao raiva contra voce.
- Reclama de outras coisas que nao sao voce/Beba Mais: "esse mercado ta dificil", "concorrencia ta apertada".
- Usa palavroes leves de enfase ("porra ne", "ta foda esse trafego") sem agressao direcionada.
- Demonstra PRESSA ou INSISTENCIA sem ofensa: "so me fala o preco, rapido", "anda logo", "como assim nao sabe?", "responde logo". Cliente apressado/insistente NAO eh irritado — classifica "nenhum" e o atendimento continua.
Frustracao leve, desabafo, pressa, partilha de problema: classifica "nenhum". "irritado" exige HOSTILIDADE dirigida ao atendimento (xingamento, ofensa, ameaca de desistir pela raiva).

3. "pede_humano" — lead pede EXPLICITAMENTE pra ser TRANSFERIDO/FALAR com uma pessoa/humano/atendente/vendedor/gerente/responsavel. Ex: "quero falar com uma pessoa", "me passa pro humano", "passa pro atendente", "quero falar com o responsavel", "chama alguem ai".

ATENCAO — NAO eh "pede_humano" se:
- Lead apenas PERGUNTA se voce eh humano/bot/IA ("voce eh humano?", "eh bot?", "eh IA?", "vc eh real?"). Isso eh curiosidade, classifica "nenhum".
- Lead diz "ah humano demais kkk" ou comenta sobre humanidade sem pedir transferencia.
- Lead CUMPRIMENTA, CHAMA ou MENCIONA um destes nomes: {{PERSONAS}}. TODOS esses nomes sao VOCE — atendentes virtuais do MESMO sistema (a mesma IA), NAO pessoas diferentes. Ex: "oi Yasmin", "tava falando com o Caio", "o Caio me passou pra voce", "pega com o Caio o que conversamos". Cumprimentar/mencionar qualquer um deles NAO eh "pede_humano" (classifica "nenhum"). So eh "pede_humano" quando o lead pede uma PESSOA REAL / atendente HUMANO, fora desses nomes.

4. "nenhum" — qualquer outra coisa. Conversa normal, pergunta sobre produto, agradece, pergunta se voce eh humano/bot, etc.

REGRAS:
- Se duvidoso, classifica "nenhum".
- "muda_reuniao": classifica quando o lead se refere de forma DEFINIDA a uma retirada de pedido DELE — pedindo pra remarcar, trocar horario ou cancelar (ex: "cancelar a retirada que marquei", "minha retirada", "preciso remarcar nossa retirada"). Vale MESMO que a retirada nao apareca no contexto recente, desde que o lead afirme ter uma. NAO classifica se for HIPOTETICO/futuro ("e se eu precisar cancelar depois?", "da pra remarcar caso precise?").
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
  personas?: string[];
}): Promise<ResultadoHandoff> {
  const nomes = (opts.personas && opts.personas.length ? opts.personas : ["Caio"])
    .map((p) => p.trim())
    .filter(Boolean);
  const sys = SYSTEM_PROMPT.replaceAll("{{PERSONAS}}", nomes.join(", "));
  const result = await chatCompletion({
    messages: [
      { role: "system", content: sys },
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
