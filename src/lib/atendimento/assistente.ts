/**
 * O pré-atendente: responde o cliente na hora, entende o assunto e passa a
 * conversa para uma atendente. Ele NÃO fecha pedido, NÃO passa preço e NÃO
 * promete prazo — isso fica com as atendentes, no tom delas.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion, type ChatMessage } from "@/lib/caio/openai";
import { enviarTexto, mostrarDigitando } from "./whatsapp";
import {
  MAX_RESPOSTAS_ASSISTENTE,
  estaAberto,
  horariosEmTexto,
  normalizarConfig,
  proximaAbertura,
  agoraSaoPaulo,
  NOME_DIA,
  type Assunto,
} from "./regras";

const ASSUNTOS: Assunto[] = ["pedido", "orcamento", "duvida", "pos_venda", "outro"];

export type Saudacao = "bom dia" | "boa tarde" | "boa noite";

/** Cumprimento certo para o horário de São Paulo (calculado pelo código, não pela IA). */
export function saudacaoPara(minutoDoDia: number): Saudacao {
  if (minutoDoDia >= 5 * 60 && minutoDoDia < 12 * 60) return "bom dia";
  if (minutoDoDia >= 12 * 60 && minutoDoDia < 18 * 60) return "boa tarde";
  return "boa noite";
}

export interface Decisao {
  resposta: string;
  assunto: Assunto;
  passar: boolean;
}

/** Instruções fixas do assistente. Informações da loja vêm do painel (admin). */
export function montarInstrucoes(opts: {
  nomeAssistente: string;
  nomeEmpresa: string;
  cidade: string;
  informacoesLoja: string;
  horarios: string;
  aberto: boolean;
  proximaAbertura: string | null;
  agoraTexto: string;
  nomeCliente: string | null;
  respostasJaDadas: number;
  saudacao: Saudacao;
}): string {
  const situacaoLoja = opts.aberto
    ? "A loja está ABERTA agora. As atendentes respondem em poucos minutos."
    : `A loja está FECHADA agora${opts.proximaAbertura ? ` e abre ${opts.proximaAbertura}` : ""}. Quando passar a conversa, avise que uma atendente responde assim que a loja abrir.`;

  return `Você é ${opts.nomeAssistente}, do atendimento de ${opts.nomeEmpresa} no WhatsApp.

A LOJA: distribuidora e depósito de bebidas em ${opts.cidade}. Isso você sempre pode dizer.

SEU PAPEL: fazer só o PRIMEIRO atendimento. Cumprimentar, entender o que o cliente precisa e deixar a conversa pronta para uma atendente humana continuar. Quem gera o pedido, passa valores e combina a entrega são as atendentes.

COMO ESCREVER (igual às atendentes da loja): frases curtas, educadas e simples. Sem emoji. Fale sempre no plural, em nome da loja ("recebemos", "podemos ajudar", "entregamos"), nunca "recebi" ou "posso". Fale direto com o cliente ("você"), nunca "o cliente". Nunca copie o texto das informações da loja como está: responda com suas palavras. Não repita o que o cliente acabou de dizer. Frases das informações como "não é para todos os clientes" ou "a atendente verifica" são instruções para você agir, não para repetir ao cliente: nesses casos diga só que uma atendente verifica com ele.
CUMPRIMENTO DE AGORA: "Olá, ${opts.saudacao}!". Use exatamente esse cumprimento (nunca outro período do dia). ${opts.respostasJaDadas === 0 ? 'Esta é a PRIMEIRA mensagem da conversa: comece com ele (pode incluir o primeiro nome do cliente, ex.: "Olá, João, ' + opts.saudacao + '!").' : "Não cumprimente de novo."}

REGRAS QUE NUNCA PODEM SER QUEBRADAS:
1. Nunca informe preço, valor, total, desconto, taxa de entrega, estoque, disponibilidade de produto ou horário/prazo de entrega. Diga que a atendente confirma.
2. Nunca confirme o pedido e nunca diga "anotei". Nunca escreva nenhum produto, marca, número ou quantidade que o cliente mandou: diga apenas "recebemos seu pedido".
3. Nunca invente informação. Só responda uma dúvida se a resposta estiver ESCRITA nas INFORMAÇÕES DA LOJA abaixo (ou for a cidade da loja). Se não estiver escrita, não diga sim nem não: diga que a atendente confirma e passe a conversa.
4. No máximo 2 frases curtas e no máximo 1 pergunta por mensagem. Fale "atendente" no máximo uma vez.
5. Se perguntarem se você é robô ou pessoa, diga com naturalidade que é o assistente virtual de ${opts.nomeEmpresa} e que uma atendente vai continuar o atendimento.

O QUE FAZER EM CADA CASO (os textos entre aspas são modelos de tom; adapte com suas palavras):
- Cliente mandou o pedido (lista de produtos, quantidades, foto, planilha ou arquivo): "Recebemos seu pedido. Uma atendente já vai gerar e te mandar para conferir." (loja fechada: "...assim que a loja abrir"). Sem perguntas. assunto = pedido, passar = true.
- Cliente quer comprar mas ainda não disse o quê: pergunte o que ele precisa. assunto = pedido, passar = false. Quando ele disser, avise que a atendente já vai continuar e passar = true.
- Orçamento para festa ou evento. O orçamento precisa só de duas coisas: a DATA e O QUE precisa (lista de bebidas OU número de pessoas).
  - Se faltar alguma, peça só o que falta, numa pergunta curta (ex.: "Para quando é o evento?" ou "Para quantas pessoas?"). passar = false.
  - Se já tem as duas (na mensagem atual ou antes): responda só "Recebemos as informações. Uma atendente já vai montar o seu orçamento." Não peça mais nada, não repita data nem lista, nunca peça quantidade de cada item. passar = true.
  - assunto = orcamento.
- Dúvida que as INFORMAÇÕES DA LOJA respondem (horário, endereço, retirada, formas de pagamento): responda com a informação COMPLETA, com todos os itens escritos (ex.: "Aceitamos Pix, dinheiro e cartão."), e termine com "Podemos ajudar em algo mais?". assunto = duvida, passar = false.
- Pergunta se entregamos em um bairro ou cidade da região: responda com a área de entrega escrita. Se o cliente não disse a cidade e o bairro pode ser de outra cidade, condicione sem repetir o nome da cidade: "Entregamos em todos os bairros de Americana. Uma atendente confirma o seu endereço com você." Se a cidade for uma das que a atendente confirma, diga isso. passar = true quando a atendente precisar confirmar.
- Pergunta sobre preço (mesmo sem "R$", como "ainda tá 45?"), se tem um produto, estoque ou prazo de entrega: "Uma atendente já vai te passar essa informação." assunto = duvida, passar = true. Não fale de localização.
- Entrega em outro estado ou país (Bahia, Dubai): não diga sim nem não e não diga onde entregamos. Em tom formal: "Estamos localizados em ${opts.cidade}. Uma atendente já vai entrar em contato para te atender melhor." assunto = duvida, passar = true. Nunca "ficamos" ou "somos daqui de".
- Produto ou serviço que claramente não tem nada a ver com bebidas (cafezinho, pão de queijo, roupa): isso é pergunta sobre a loja, não conversa fora do assunto. Não diga sim nem não: "Somos uma distribuidora de bebidas em ${opts.cidade}. Uma atendente já vai te responder sobre isso." passar = true.
- Assuntos de depois da venda (nota fiscal, boleto, comprovante, reembolso, troca): diga o que vai ser feito, ex.: "Vamos verificar a sua nota fiscal. Uma atendente já te responde." assunto = pos_venda, passar = true.
- Reclamação (atraso, produto errado ou quente, entregador): peça desculpas primeiro: "Lamentamos muito o ocorrido. Uma atendente já vai falar com você para resolver." assunto = pos_venda, passar = true.
- Cliente pede para falar com uma pessoa, está irritado, ou o assunto não se encaixa em nada aqui: passar = true.
- Conversa que não tem NADA a ver com a loja nem com produtos (futebol, piada, política, clima, perguntas pessoais): não entre no assunto e não fale de localização: "Aqui é o atendimento da ${opts.nomeEmpresa}. Podemos ajudar com algum pedido ou dúvida?" assunto = outro, passar = false.
- LOJA FECHADA e o cliente quer comprar, precisa de algo ou perguntou se abrimos: diga que estamos fechados, quando abrimos e que uma atendente responde assim que a loja abrir. Não pergunte "podemos ajudar em algo mais?". passar = true (senão o pedido fica parado e ninguém vê).
- Só um cumprimento ("oi", "bom dia"): cumprimente e pergunte "Como podemos ajudar?". passar = false.
- Sempre que passar = true, a resposta tem que dizer que uma atendente vai continuar. E sempre que a resposta falar em atendente, passar TEM que ser true.

ASSUNTO: pedido = mandou pedido ou quer comprar (inclusive fora do horário); duvida = pergunta sobre a loja, preço ou produto; orcamento = festa ou evento; pos_venda = depois da compra ou reclamação; outro = o resto.

SITUAÇÃO AGORA: ${opts.agoraTexto}. ${situacaoLoja}
Horários de atendimento: ${opts.horarios}.
${opts.nomeCliente ? `Nome do cliente no WhatsApp: ${opts.nomeCliente} (use só o primeiro nome, e só se parecer um nome de pessoa).` : ""}
${opts.respostasJaDadas > 0 ? `Você já mandou ${opts.respostasJaDadas} mensagem(ns) nesta conversa.` : ""}

INFORMAÇÕES DA LOJA:
${opts.informacoesLoja.trim() || "(nenhuma informação cadastrada — para qualquer dúvida, passe para a atendente)"}

RESPONDA SOMENTE com um JSON neste formato:
{"resposta": "texto da mensagem para o cliente", "assunto": "pedido" | "orcamento" | "duvida" | "pos_venda" | "outro", "passar_para_atendente": true | false}`;
}

/** Lê e valida o JSON do modelo. Qualquer coisa estranha vira "passa para a atendente". */
export function interpretarResposta(conteudo: string, aberto: boolean): Decisao {
  try {
    const j = JSON.parse(conteudo) as { resposta?: unknown; assunto?: unknown; passar_para_atendente?: unknown };
    const resposta = typeof j.resposta === "string" ? j.resposta.trim() : "";
    const assunto = ASSUNTOS.includes(j.assunto as Assunto) ? (j.assunto as Assunto) : "outro";
    const passar = j.passar_para_atendente === true;
    if (!resposta) return respostaDeSeguranca(aberto, assunto);
    return { resposta, assunto, passar };
  } catch {
    return respostaDeSeguranca(aberto, "outro");
  }
}

export function respostaDeSeguranca(aberto: boolean, assunto: Assunto = "outro", saudacao?: Saudacao): Decisao {
  const ola = saudacao ? `Olá, ${saudacao}!` : "Olá!";
  if (assunto === "pedido") {
    return {
      resposta: aberto
        ? `${ola} Recebemos seu pedido, uma atendente já vai gerar e te mandar para conferir.`
        : `${ola} Recebemos seu pedido. Assim que a loja abrir, uma atendente gera e te manda para conferir.`,
      assunto,
      passar: true,
    };
  }
  return {
    resposta: aberto
      ? `${ola} Recebemos sua mensagem, uma atendente já vai te responder.`
      : `${ola} Recebemos sua mensagem. Uma atendente te responde assim que a loja abrir.`,
    assunto,
    passar: true,
  };
}

/** Valor em dinheiro, escrito de qualquer jeito ("R$ 89", "89,90", "45 conto", "30 reais"). */
const RE_DINHEIRO = /R\$|\d+[,.]\d{2}\b|\breais\b|\d+\s*real\b|\d+\s*(contos?|pilas?)\b/i;
/** Número junto de unidade de venda ("3 fardos", "89 o fardo", "2L"): preço ou lista do pedido repetida. */
const RE_QUANTIDADE =
  /\d+\s*(o |a |cada |por )?(fardos?|caixas?|cx|unidades?|un\b|latas?|garrafas?|packs?|litros?|l\b|ml\b|sacos?|gal[õo]es|gal[ãa]o|engradados?|barras?)/i;
/** A resposta promete atendente/pessoa da loja. */
const RE_FALA_DE_ATENDENTE = /atendente|algu[ée]m da (loja|equipe)|nossa equipe|uma pessoa/i;

export interface ContextoTravas {
  respostasJaDadas: number;
  aberto: boolean;
  saudacao: Saudacao;
  /** Assunto que a conversa já tinha (não deixa virar "outro" no meio do caminho). */
  assuntoAnterior?: Assunto | null;
  /** O que o cliente escreveu desde a última resposta do assistente. */
  textoCliente?: string;
}

/** Cliente pedindo para falar com gente ("quero falar com uma pessoa", "não quero robô"). */
export const RE_PEDE_PESSOA =
  /(falar|conversar|atendimento) com (uma |um |a |o |alg)?\s*(pessoa|humano|gente|atendente|algu[ée]m|vendedor)|n[ãa]o quero (falar com |conversar com )?(rob[ôo]|bot|m[áa]quina|ia\b)|(me )?passa (pra|para) (uma |um |a |o )?(pessoa|humano|atendente|algu[ée]m)|\bquero (uma |um |a |o )?(atendente|pessoa|humano)\b|\b(chama|chame) (uma |um |a |o )?(atendente|pessoa|algu[ée]m)/i;

/** Corrige o período do dia e garante o cumprimento na primeira mensagem; fala no plural. */
export function ajustarTom(texto: string, saudacao: Saudacao, primeira: boolean): string {
  let t = texto.replace(/\b(bom dia|boa tarde|boa noite)\b/gi, (m) => (m[0] === m[0].toUpperCase() ? saudacao[0].toUpperCase() + saudacao.slice(1) : saudacao));
  t = t.replace(/\bRecebi\b/g, "Recebemos").replace(/\brecebi\b/g, "recebemos");
  t = t.replace(/\bPosso ajudar\b/g, "Podemos ajudar").replace(/\bposso ajudar\b/g, "podemos ajudar");
  t = t.replace(/\b([Oo]) cliente (pode|deve|precisa|consegue)\b/g, (_m, o: string, v: string) => `${o === "O" ? "Você" : "você"} ${v}`);
  if (primeira && !/^\s*ol[áa](?![a-z])/i.test(t)) t = `Olá, ${saudacao}! ${t}`;
  return t.trim();
}

/** Travas finais do código: valem mesmo que a IA desobedeça as instruções. */
export function aplicarTravas(d: Decisao, ctx: ContextoTravas): Decisao {
  let decisao = d;
  const primeira = ctx.respostasJaDadas === 0;
  // Pediu uma pessoa: não discute, passa na hora.
  if (ctx.textoCliente && RE_PEDE_PESSOA.test(ctx.textoCliente)) {
    const fim = ctx.aberto ? "Claro, uma atendente já vai falar com você." : "Claro, uma atendente te responde assim que a loja abrir.";
    return { resposta: primeira ? `Olá, ${ctx.saudacao}! ${fim}` : fim, assunto: ctx.assuntoAnterior ?? d.assunto, passar: true };
  }
  // Mantém o assunto da conversa quando a IA responde "outro" depois (ex.: orçamento em duas etapas).
  if (decisao.assunto === "outro" && ctx.assuntoAnterior && ctx.assuntoAnterior !== "outro") {
    decisao = { ...decisao, assunto: ctx.assuntoAnterior };
  }
  // Valor em dinheiro ou quantidade/produto na resposta: não manda; usa a resposta padrão e passa.
  if (RE_DINHEIRO.test(decisao.resposta) || RE_QUANTIDADE.test(decisao.resposta)) {
    return respostaDeSeguranca(ctx.aberto, decisao.assunto, ctx.respostasJaDadas === 0 ? ctx.saudacao : undefined);
  }
  decisao = { ...decisao, resposta: ajustarTom(decisao.resposta, ctx.saudacao, ctx.respostasJaDadas === 0) };
  // Respondeu uma dúvida: o fecho é "algo mais?", não "como podemos ajudar?" (isso é para quem só disse oi).
  const semCumprimento = decisao.resposta.replace(/^\s*ol[áa][^!.]*[!.]\s*/i, "");
  if (decisao.assunto !== "outro" && /\S.*?\s*Como (podemos|posso) ajudar\?\s*$/i.test(semCumprimento) && !/^\s*Como (podemos|posso) ajudar\?\s*$/i.test(semCumprimento)) {
    decisao = { ...decisao, resposta: decisao.resposta.replace(/\s*Como (podemos|posso) ajudar\?\s*$/i, " Podemos ajudar em algo mais?") };
  }
  // Loja fechada: qualquer assunto da loja vai para a fila, para a atendente ver quando abrir.
  if (!ctx.aberto && !decisao.passar && decisao.assunto !== "outro") decisao = { ...decisao, passar: true };
  // Falou em atendente: a conversa TEM que ir para a fila (senão ninguém é avisado).
  if (!decisao.passar && RE_FALA_DE_ATENDENTE.test(decisao.resposta)) decisao = { ...decisao, passar: true };
  // Conversa está rodando demais com o assistente: a próxima palavra é da atendente.
  if (!decisao.passar && ctx.respostasJaDadas + 1 >= MAX_RESPOSTAS_ASSISTENTE) decisao = { ...decisao, passar: true };
  // Vai para a fila: não termina com pergunta ao cliente e sempre avisa que uma atendente continua.
  if (decisao.passar) {
    let r = decisao.resposta.replace(/\s*(Como )?(Podemos|Posso) (te )?ajudar[^?]*\?\s*$/i, "").trim();
    if (!RE_FALA_DE_ATENDENTE.test(r)) r = `${r} ${ctx.aberto ? "Uma atendente já vai falar com você." : "Uma atendente te responde assim que a loja abrir."}`.trim();
    decisao = { ...decisao, resposta: r };
  }
  return decisao;
}

function descreverMensagem(m: { tipo: string; conteudo: string | null; arquivo_nome: string | null }): string {
  const texto = (m.conteudo ?? "").trim();
  switch (m.tipo) {
    case "imagem":
      return `[enviou uma foto]${texto ? ` ${texto}` : ""}`;
    case "arquivo":
      return `[enviou um arquivo${m.arquivo_nome ? `: ${m.arquivo_nome}` : ""}]${texto ? ` ${texto}` : ""}`;
    case "video":
      return `[enviou um vídeo]${texto ? ` ${texto}` : ""}`;
    case "audio":
      return texto ? `[áudio transcrito] ${texto}` : "[enviou um áudio]";
    case "localizacao":
      return `[enviou a localização] ${texto}`;
    default:
      return texto || "[mensagem vazia]";
  }
}

function tempoDigitacao(texto: string): number {
  const base = Math.max(3000, Math.min(texto.length * 60, 9000));
  return Math.floor(base * (0.8 + Math.random() * 0.4));
}

/**
 * Gera e envia a resposta do assistente para um cliente.
 * Confere o estado antes de enviar: se uma atendente pegou a conversa nesse
 * meio tempo, o assistente fica quieto.
 */
export async function responderCliente(leadId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, organization_id, nome, atend_status, assunto, conversa_iniciada_em, respostas_bot, evolution_instance, caio_ativo, assistente_viu_ate")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead || lead.atend_status !== "bot" || lead.caio_ativo === false) return;

  const [{ data: org }, { data: numero }] = await Promise.all([
    admin.from("organizations").select("name, base_conhecimento, atendimento_config").eq("id", lead.organization_id).maybeSingle(),
    lead.evolution_instance
      ? admin.from("org_numeros").select("persona_nome").eq("instance_name", lead.evolution_instance).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const cfg = normalizarConfig(org?.atendimento_config);
  const agora = new Date();
  const aberto = estaAberto(cfg, agora);
  const sp = agoraSaoPaulo(agora);
  const saudacao = saudacaoPara(sp.minuto);

  let historicoQuery = admin
    .from("mensagens")
    .select("direcao, autor, tipo, conteudo, arquivo_nome, created_at")
    .eq("lead_id", leadId)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(16);
  if (lead.conversa_iniciada_em) historicoQuery = historicoQuery.gte("created_at", lead.conversa_iniciada_em);
  const { data: msgs } = await historicoQuery;
  const historico = (msgs ?? []).reverse();
  // Responde só se tem mensagem do cliente que o assistente ainda não viu.
  const entradas = historico.filter((m) => m.direcao === "entrada");
  const ultimaEntradaEm = entradas.length ? entradas[entradas.length - 1].created_at : null;
  if (!ultimaEntradaEm) return;
  if (lead.assistente_viu_ate && new Date(ultimaEntradaEm).getTime() <= new Date(lead.assistente_viu_ate).getTime()) return;
  const viuAte = lead.assistente_viu_ate ? new Date(lead.assistente_viu_ate).getTime() : 0;
  const textoCliente = entradas
    .filter((m) => new Date(m.created_at).getTime() > viuAte)
    .map((m) => m.conteudo ?? "")
    .join("\n");

  const instrucoes = montarInstrucoes({
    nomeAssistente: numero?.persona_nome?.trim() || "o assistente virtual",
    nomeEmpresa: org?.name?.trim() || "a loja",
    cidade: cfg.cidade,
    informacoesLoja: org?.base_conhecimento ?? "",
    horarios: horariosEmTexto(cfg, agora),
    aberto,
    proximaAbertura: proximaAbertura(cfg, agora),
    agoraTexto: `${NOME_DIA[sp.dia]}, ${sp.hhmm}`,
    nomeCliente: lead.nome ?? null,
    respostasJaDadas: lead.respostas_bot ?? 0,
    saudacao,
  });

  const mensagens: ChatMessage[] = [{ role: "system", content: instrucoes }];
  for (const m of historico) {
    const texto = descreverMensagem(m);
    if (m.direcao === "entrada") mensagens.push({ role: "user", content: texto });
    else if (m.autor === "assistente") mensagens.push({ role: "assistant", content: JSON.stringify({ resposta: texto, passar_para_atendente: false }) });
    else mensagens.push({ role: "user", content: `[mensagem da atendente da loja para o cliente] ${texto}` });
  }

  const r = await chatCompletion({ messages: mensagens, temperature: 0.3, max_tokens: 300, json: true });
  let decisao = "error" in r ? respostaDeSeguranca(aberto, "outro", saudacao) : interpretarResposta(r.content, aberto);
  if ("error" in r) console.error("[assistente] IA falhou, usando resposta de segurança:", r.error);
  decisao = aplicarTravas(decisao, {
    respostasJaDadas: lead.respostas_bot ?? 0,
    aberto,
    saudacao,
    assuntoAnterior: (lead.assunto as Assunto | null) ?? null,
    textoCliente,
  });

  // "Digitando..." por alguns segundos, depois confere de novo se ainda é a vez do assistente.
  const ms = tempoDigitacao(decisao.resposta);
  await mostrarDigitando(leadId, ms);
  await new Promise((res) => setTimeout(res, ms));
  const { data: atual } = await admin.from("leads").select("atend_status, caio_ativo").eq("id", leadId).maybeSingle();
  if (!atual || atual.atend_status !== "bot" || atual.caio_ativo === false) return;

  const envio = await enviarTexto({ leadId, texto: decisao.resposta, autor: "assistente", remetenteNome: "Assistente" });
  if ("error" in envio) console.error("[assistente] envio falhou:", envio.error);

  const upd: Record<string, unknown> = {
    respostas_bot: (lead.respostas_bot ?? 0) + 1,
    assunto: decisao.assunto,
    assistente_viu_ate: ultimaEntradaEm,
  };
  if (decisao.passar || "error" in envio) {
    upd.atend_status = "aguardando";
    upd.aguardando_desde = new Date().toISOString();
    upd.avisos_espera = 0;
  }
  // Só aplica se ninguém pegou a conversa enquanto a mensagem saía.
  const { data: aplicado } = await admin.from("leads").update(upd).eq("id", leadId).eq("atend_status", "bot").select("id");

  // O cliente mandou mais alguma coisa enquanto o assistente "digitava"? Responde de novo.
  if (aplicado?.length && !upd.atend_status) {
    const { data: novas } = await admin
      .from("mensagens")
      .select("id")
      .eq("lead_id", leadId)
      .eq("direcao", "entrada")
      .gt("created_at", ultimaEntradaEm)
      .limit(1);
    if (novas?.length) setTimeout(() => void agendarResposta(leadId).catch(() => {}), 0);
  }
}

/**
 * Espera o cliente terminar de mandar mensagens (muita gente manda o pedido em
 * várias mensagens seguidas) e só então responde, uma vez.
 * Cada mensagem nova marca um horário previsto; só quem ainda for o "último" responde.
 */
export async function agendarResposta(leadId: string): Promise<void> {
  const admin = createAdminClient();
  const esperaMs = 8000 + Math.floor(Math.random() * 4000);
  const previsto = new Date(Date.now() + esperaMs).toISOString();
  await admin.from("leads").update({ caio_responder_em: previsto }).eq("id", leadId);
  await new Promise((r) => setTimeout(r, esperaMs));

  const { data: lead } = await admin.from("leads").select("caio_responder_em").eq("id", leadId).maybeSingle();
  if (!lead?.caio_responder_em || new Date(lead.caio_responder_em).getTime() !== new Date(previsto).getTime()) {
    return; // chegou mensagem mais nova; aquele ciclo responde
  }

  // Trava: um ciclo por vez por cliente (evita duas respostas se a IA demorar).
  // 5 minutos cobre o pior caso (IA com novas tentativas + digitação + envio).
  const limite = new Date(Date.now() - 5 * 60_000).toISOString();
  const minhaTrava = new Date().toISOString();
  const { data: travou } = await admin
    .from("leads")
    .update({ caio_processing_since: minhaTrava })
    .eq("id", leadId)
    .or(`caio_processing_since.is.null,caio_processing_since.lt.${limite}`)
    .select("id")
    .maybeSingle();
  if (!travou) {
    // Outro ciclo está respondendo; tenta de novo daqui a pouco (ele pode já ter respondido tudo).
    setTimeout(() => void agendarResposta(leadId).catch(() => {}), 15000);
    return;
  }
  try {
    await responderCliente(leadId);
  } finally {
    await admin.from("leads").update({ caio_responder_em: null }).eq("id", leadId).eq("caio_responder_em", previsto);
    // Solta só a própria trava (outro ciclo pode ter assumido depois de 5 min).
    await admin.from("leads").update({ caio_processing_since: null }).eq("id", leadId).eq("caio_processing_since", minhaTrava);
  }
}
