import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion, type ChatMessage } from "./openai";
import { getAgendaConfig, janelaFuncionamento } from "./agenda-config";
import { personaDoLead } from "./numeros";

const NOMES_DIAS = [
  "",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
  "domingo",
];

function descreverDias(dias: number[]): string {
  if (dias.length === 7) return "todos os dias";
  if (
    dias.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => dias.includes(d))
  ) {
    return "de segunda a sexta";
  }
  return dias.map((d) => NOMES_DIAS[d] ?? "").join(", ");
}

/**
 * Gera uma resposta como o atendente IA responderia, baseado no histórico do lead.
 *
 * Pega últimas N mensagens (não-shadow) do lead, monta o contexto no
 * formato OpenAI e chama o modelo configurado em OPENAI_MODEL.
 *
 * Retorna apenas o texto — quem chama decide se envia, salva como shadow,
 * mostra na UI, etc.
 */
export async function gerarRespostaCaio(opts: {
  leadId: string;
  limit?: number;
  /**
   * Linhas extras a injetar no bloco [Contexto] do system prompt. Usado por
   * callers que querem dar instruções específicas pra essa resposta (ex:
   * propor horários, confirmar agendamento criado). Cada string vira um
   * parágrafo separado.
   */
  extrasContexto?: string[];
  /**
   * Substitui o prompt-base (comportamento) por um prompt focado pra esta
   * geração — ex: follow-up usa um prompt próprio em vez do de qualificação.
   * A base de conhecimento (se houver) continua sendo anexada.
   */
  promptBaseOverride?: string;
  /**
   * Mensagem de SISTEMA injetada DEPOIS do histórico — é a última coisa que o
   * modelo lê antes de gerar. Serve pra vencer a tendência do gpt-4o-mini de
   * "continuar" a conversa / re-responder a última pergunta do lead: o system
   * prompt do topo perde pro histórico recente, mas um lembrete no fim domina.
   * Ex: o follow-up reforça aqui que é só um nudge curto, não uma re-resposta.
   */
  lembreteFinal?: string;
}): Promise<{ resposta: string } | { error: string }> {
  const limit = opts.limit ?? 30;
  const supabase = createAdminClient();

  const [{ data: lead }, { data: mensagens }] = await Promise.all([
    supabase
      .from("leads")
      .select("nome, organization_id, origem, origem_inicial, dados_extras, evolution_instance")
      .eq("id", opts.leadId)
      .single(),
    supabase
      .from("mensagens")
      .select("conteudo, direcao, tipo, created_at")
      .eq("lead_id", opts.leadId)
      .eq("shadow", false) // ignora as próprias shadows do histórico
      // Pega as N MAIS RECENTES (desc + limit), depois reverte pra cronológica
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (!mensagens || mensagens.length === 0) {
    return { error: "Lead sem mensagens" };
  }
  // Inverte pra ordem cronológica (mais antiga primeiro) — é como o OpenAI espera
  mensagens.reverse();

  // Prompt vem exclusivamente da organization — sem fallback hardcoded.
  if (!lead?.organization_id) {
    return { error: "Lead sem organization vinculada" };
  }
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "prompt_system, prompt_system_prospeccao, base_conhecimento, agenda_config",
    )
    .eq("id", lead.organization_id)
    .single();
  // Comportamento (como o atendente age) varia por canal. Base de conhecimento
  // (o que o atendente sabe sobre a empresa) é compartilhada.
  //   - prospeccao + comportamento de prospeccao preenchido → usa ele
  //   - resto → usa o inbound padrao
  // Se prospeccao sem comportamento proprio, cai no inbound — pelo menos
  // tem instrucao base, e o bloco de contexto que adicionamos abaixo
  // (`extras`) reforca que o canal e prospeccao.
  const ehProspeccao = lead?.origem === "prospeccao";
  const comportamentoProsp = org?.prompt_system_prospeccao?.trim();
  const comportamentoInbound = org?.prompt_system?.trim();
  const comportamento =
    ehProspeccao && comportamentoProsp
      ? comportamentoProsp
      : comportamentoInbound;
  if (!comportamento) {
    return {
      error:
        "Organization sem prompt configurado — configure em Admin → Atendente",
    };
  }
  // Follow-up (e outros callers) podem trocar o comportamento por um prompt
  // focado via promptBaseOverride; a base de conhecimento segue anexada.
  const comportamentoBase = opts.promptBaseOverride?.trim() || comportamento;
  const baseConhecimento = org?.base_conhecimento?.trim();
  // Junta comportamento + base (com separador legivel). Base entra como
  // bloco rotulado pra ficar claro pro modelo onde estao os fatos.
  const promptBase = baseConhecimento
    ? `${comportamentoBase}\n\n[Base de Conhecimento da empresa — use SOMENTE essas informações como fonte de verdade, não invente outras]\n${baseConhecimento}`
    : comportamentoBase;

  const historico: ChatMessage[] = mensagens.map((m) => {
    let content: string;
    if (m.tipo !== "texto") {
      // Audio/imagem/video transcritos vao como TEXTO PURO — sem prefixo
      // "[audio: ...]" porque o LLM costuma incorporar a tag na resposta
      // ("Audio, legal!"). Sem transcricao, anota o tipo entre parenteses
      // discreto pra dar contexto sem virar bordao.
      content = m.conteudo?.trim()
        ? m.conteudo.trim()
        : `(mensagem de ${m.tipo} sem transcricao)`;
    } else {
      content = m.conteudo ?? "";
    }
    return {
      role: m.direcao === "entrada" ? "user" : "assistant",
      content,
    };
  });

  // Anexos contextuais ao prompt
  const extras: string[] = [];
  if (lead?.nome) {
    extras.push(
      `O lead se chama ${lead.nome}. Use o nome quando fizer sentido.`,
    );
  }

  // Persona por número: o NOME do atendente virtual vem SEMPRE do número que
  // serve o lead (org_numeros.persona_nome — configurável no painel, ex: Exato).
  // Os prompts-base são neutros ("atendente virtual") e o nome entra aqui.
  const persona = await personaDoLead(
    (lead as { evolution_instance?: string | null })?.evolution_instance ?? null,
  );
  if (persona?.persona_nome?.trim()) {
    const nomePersona = persona.persona_nome.trim();
    extras.push(
      `IMPORTANTE: neste atendimento o seu nome é ${nomePersona}. Sempre que se referir a si mesmo ou se apresentar, use ${nomePersona}.`,
    );
  }

  // Funcionamento da loja — incluído no fluxo normal pra que a IA responda
  // perguntas tipo "atendem sábado?" sem escalar. NÃO entra em follow-up
  // (promptBaseOverride): o follow-up é re-engajamento.
  // Contexto Beba Mais: a loja NÃO tem slots — horário do cliente é SUGESTÃO
  // que a equipe confirma. O LLM só precisa saber a janela de funcionamento.
  if (!opts.promptBaseOverride && org?.agenda_config) {
    const agenda = getAgendaConfig(org.agenda_config);
    const diasDesc = descreverDias(agenda.dias_semana);
    const { abre, fecha } = janelaFuncionamento(agenda);
    const diasPorNome = agenda.dias_semana
      .map((d) => NOMES_DIAS[d])
      .filter(Boolean)
      .join(", ");
    extras.push(
      `[Funcionamento da Beba Mais]
Dias em que a loja ABRE (use EXATAMENTE esta lista; ignore respostas anteriores suas que possam ter sido incompletas): ${diasPorNome}.
Resumo: ${diasDesc}, das ${abre} às ${fecha} (fuso de Brasília).

A loja NÃO trabalha com agendamento de horário — o cliente vem retirar (ou recebe a entrega) no horário que preferir dentro do funcionamento. Quando o cliente disser um dia/horário, trate como SUGESTÃO: diga que anotou e que a EQUIPE confirma com ele. NUNCA diga que "agendou" ou que o horário "está confirmado". NUNCA invente lista de horários disponíveis — a única regra é o funcionamento acima. Cite os horários que o cliente disser EXATAMENTE como ele disse (não arredonde).

Regras:
- Se perguntarem quando atendem, cite TODOS os dias acima e a janela ${abre} às ${fecha} exatamente. NÃO omita nenhum dia.
- Dia fora da lista (ex: domingo): explique que a loja não abre nesse dia e ofereça os dias da lista.
- Horário fora da janela: informe o funcionamento e peça outro horário.
- NÃO escale pra humano por causa de horário/dia — só por casos genuinamente complexos.

[POSTURA — VOCÊ CONDUZ]
Você SEMPRE conduz a conversa pra fechar o pedido e combinar a retirada/entrega. NUNCA deixe a decisão de avançar na mão do lead. Em qualquer interação onde ele demonstrou o mínimo de interesse:
1. Monte o pedido (itens, nome, retirada ou entrega)
2. Pergunte que dia e horário ficam melhores pra ele (dentro do funcionamento) e diga que deixa anotado pra equipe confirmar
3. Se ele desviar o assunto, responde a pergunta dele e em seguida volta pro pedido
4. NUNCA termine uma resposta com "me avisa quando quiser" ou "fica à vontade" — sempre termine com uma pergunta que faz ele avançar`,
    );
  }
  // Contexto de prospecção: cobre tanto cadência ATIVA (origem=prospeccao)
  // quanto lead que foi prospectado no passado, virou "perdido", e agora
  // respondeu (origem virou "inbound" mas origem_inicial continua "prospeccao").
  // Sem esse contexto, a IA trataria como inbound novo e responderia tipo
  // "obrigado por entrar em contato", o que confunde o lead que lembra que
  // foi a Beba Mais que iniciou.
  const foiProspectado =
    lead?.origem === "prospeccao" || lead?.origem_inicial === "prospeccao";
  if (foiProspectado) {
    if (lead?.origem === "prospeccao") {
      extras.push(
        `Esse lead veio de prospecção ATIVA — VOCÊ iniciou o contato, ele NÃO procurou a Beba Mais. NÃO use frases que sugiram que ele veio até nós, tipo: "obrigado por entrar em contato", "como posso te ajudar", "no que posso te ajudar", "em que posso ajudar", "como posso te ajudar hoje". Essas frases confundem o cliente — ele lembra que foi a Beba Mais que falou com ele. Em vez disso: trate como continuação natural do contato que VOCÊ começou. Já se apresentou, agora avance o objetivo (entender o que ele precisa, montar o pedido, combinar a retirada ou entrega). Se o cliente estranhar/perguntar por que você o contatou, explique brevemente que a Beba Mais é a distribuidora de bebidas e o que motivou a aproximação.`,
      );
    } else {
      extras.push(
        `Esse lead foi prospectado pela Beba Mais NO PASSADO — VOCÊ iniciou o contato originalmente. Ele não respondeu na época e a cadência se encerrou, mas agora ele está retomando a conversa por conta própria. NÃO use frases tipo "obrigado por entrar em contato", "como posso te ajudar", "no que posso te ajudar" — ele lembra que foi a Beba Mais que falou com ele primeiro, e essas frases vão confundi-lo. Se ele perguntar "por que você entrou em contato" ou similar, explique brevemente que a Beba Mais é a distribuidora de bebidas e pergunte se ele precisa fazer algum pedido que a gente possa ajudar.`,
      );
    }
    const dadosExtras = lead.dados_extras as Record<string, string> | null;
    if (dadosExtras && Object.keys(dadosExtras).length > 0) {
      const linhasExtras = Object.entries(dadosExtras)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n");
      extras.push(
        `Dados conhecidos sobre o lead (use quando relevante):\n${linhasExtras}`,
      );
    }
  }
  // Extras injetados pelo caller (ex: lista de horários disponíveis,
  // confirmação de agendamento criado). Concatena APÓS os extras automáticos
  // (origem, dados_extras) pra ter preferência na hora da IA formular.
  const extrasFinal = [...extras, ...(opts.extrasContexto ?? [])];
  // Persona por número (Fase 3): o prompt vem saturado de "Caio". Se o número que
  // serve o lead tem outra persona (ex: Yasmin no backup), troca "Caio" pela persona
  // NO PROMPT BASE (não nos extras) — uma linha de override não vence o prompt todo.
  const nomePersona = persona?.persona_nome?.trim();
  const promptBasePersona =
    nomePersona && nomePersona.toLowerCase() !== "caio"
      ? promptBase.split("Caio").join(nomePersona)
      : promptBase;
  const systemContent =
    extrasFinal.length > 0
      ? `${promptBasePersona}\n\n[Contexto:\n${extrasFinal.join("\n\n")}]`
      : promptBasePersona;

  // Usa o modelo configurado em OPENAI_MODEL (default gpt-4o-mini). A
  // alucinação de horários (ex: 13:00 → 14:00) é corrigida pelo pós-
  // processamento abaixo, sem depender de um modelo mais caro.
  // Lembrete final: vai DEPOIS do histórico pra ser a última instrução que o
  // modelo lê (vence a inércia de re-responder a última pergunta do lead).
  const mensagensChat: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...historico,
  ];
  if (opts.lembreteFinal?.trim()) {
    mensagensChat.push({ role: "system", content: opts.lembreteFinal.trim() });
  }

  const result = await chatCompletion({
    messages: mensagensChat,
    temperature: 0.8,
    max_tokens: 400,
  });

  if ("error" in result) return result;

  // (Sem pós-processamento de horário: no modelo de slots existia um "fix"
  // que trocava qualquer HH:mm da resposta pelo slot mais próximo. Com
  // horário-como-sugestão isso corrompia a resposta — cliente sugeria 16:30
  // e ouvia "anotei 15:30". Qualquer horário dentro do funcionamento é
  // válido; quem valida é o tentarAgendar.)
  return { resposta: result.content.trim() };
}
