import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion, type ChatMessage } from "./openai";
import { getAgendaConfig } from "./agenda-config";
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

  // Disponibilidade da agenda — incluída no fluxo normal pra que a IA responda
  // perguntas tipo "atendem sábado?" sem escalar. NÃO entra em follow-up
  // (promptBaseOverride): o follow-up é re-engajamento, e listar horários empurrava
  // o modelo pro agendamento — atropelava o break-up do último nível com lead engajado.
  if (!opts.promptBaseOverride && org?.agenda_config) {
    const agenda = getAgendaConfig(org.agenda_config);
    const diasDesc = descreverDias(agenda.dias_semana);

    if (agenda.modo === "slot") {
      // Lista textual dos horários de INÍCIO (que é o que importa pro lead
      // escolher). Com instrução EXPLÍCITA de não alterar. Sem isso o LLM
      // tende a "regularizar" pra hora cheia (ex: 13:00 vira 14:00).
      const inicios = agenda.slots.map((s) => `"${s.inicio}"`).join(", ");
      const slotsDetalhe = agenda.slots
        .map(
          (s, i) =>
            `${i + 1}) ${s.inicio} (até ${s.fim})`,
        )
        .join("\n");
      const diasPorNome = agenda.dias_semana
        .map((d) => NOMES_DIAS[d])
        .filter(Boolean)
        .join(", ");
      extras.push(
        `[Disponibilidade da Beba Mais]
Dias ATENDIDOS (use EXATAMENTE esta lista; ignore respostas anteriores suas que possam ter sido incompletas): ${diasPorNome}.
Resumo: ${diasDesc} (fuso de Brasília).

Horários FIXOS de início de retirada (NÃO altere esses números, NÃO arredonde, NÃO invente outros — 13:00 NÃO vira 14:00):
${slotsDetalhe}

Em texto livre, os únicos horários de início válidos são EXATAMENTE: ${inicios}. NUNCA cite outros números.

Regras:
- Se o lead perguntar quando atendem, cite TODOS os dias acima e os horários acima exatamente. NÃO omita nenhum dia.
- Se ele perguntar sobre um dia específico que ESTÁ na lista (ex: "atendem terça?"), confirme que sim e ofereça os horários.
- Se ele pedir um dia FORA da lista (ex: sábado, domingo), explique que não atendemos e ofereça os dias da lista.
- NÃO escale pra humano por causa de horário/dia — só por casos genuinamente complexos.

[POSTURA — VOCÊ CONDUZ]
Você SEMPRE conduz a conversa pra fechar o pedido e agendar a retirada. NUNCA deixe a decisão de avançar na mão do lead. Em qualquer interação onde ele demonstrou o mínimo de interesse:
1. Pergunte DIRETAMENTE qual dia da semana é melhor pra ele (entre os dias atendidos)
2. Depois que ele indicar o dia, oferece os horários daquele dia (isso será tratado automaticamente)
3. Se ele desviar o assunto, responde a pergunta dele e em seguida volta pra agendar
4. NUNCA termine uma resposta com "me avisa quando quiser" ou "fica à vontade" — sempre termine com uma pergunta que faz ele avançar (ex: "qual dia da semana funciona melhor pra você?")`,
      );
    } else {
      // Modo duracao: lista as janelas + a duração padrão
      const janelas = agenda.slots
        .map((s) => `${s.inicio} às ${s.fim}`)
        .join(", ");
      extras.push(
        `[Disponibilidade da Beba Mais]
Dias atendidos: ${diasDesc} (fuso de Brasília).
Janelas de atendimento: ${janelas}.
Duração padrão da retirada: ${agenda.duracao_padrao} minutos.

Regras:
- Se o lead pedir dia/horário fora disso, explique e ofereça alternativas dentro das janelas.
- NÃO escale pra humano por causa de horário/dia — só por casos genuinamente complexos.`,
      );
    }
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

  // Pós-processamento: se a config tem slots, substitui horários inválidos
  // pelo válido mais próximo. Rede de segurança contra alucinação residual.
  let resposta = result.content.trim();
  if (org?.agenda_config) {
    const agenda = getAgendaConfig(org.agenda_config);
    if (agenda.modo === "slot") {
      const permitidos = new Set(agenda.slots.map((s) => s.inicio));
      // Inclui também os horários de FIM como permitidos (caso a IA cite
      // a faixa completa "13:00 às 15:30")
      agenda.slots.forEach((s) => permitidos.add(s.fim));
      const minutos = (hhmm: string) => {
        const [h, m] = hhmm.split(":").map(Number);
        return h * 60 + m;
      };
      const validosSorted = Array.from(permitidos).sort(
        (a, b) => minutos(a) - minutos(b),
      );
      resposta = resposta.replace(/\b(\d{1,2}):(\d{2})\b/g, (match, h, m) => {
        const horaPad = String(h).padStart(2, "0");
        const candidato = `${horaPad}:${m}`;
        if (permitidos.has(candidato)) return candidato;
        // Encontra o mais próximo (distância em minutos)
        const tgt = minutos(candidato);
        let melhor = validosSorted[0];
        let melhorDist = Math.abs(minutos(melhor) - tgt);
        for (const cand of validosSorted) {
          const d = Math.abs(minutos(cand) - tgt);
          if (d < melhorDist) {
            melhor = cand;
            melhorDist = d;
          }
        }
        // Só substitui se a distância é razoável (até 90 min); senão deixa
        // como está (provavelmente é referência a horário do lead, não slot)
        if (melhorDist <= 90) {
          console.log(
            "[caio:fix-horario] substituindo",
            match,
            "→",
            melhor,
          );
          return melhor;
        }
        return match;
      });
    }
  }

  return { resposta };
}
