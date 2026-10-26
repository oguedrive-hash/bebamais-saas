/**
 * O pré-atendente: responde o cliente na hora, entende o assunto e passa a
 * conversa para uma atendente. Ele NÃO fecha pedido, NÃO passa preço e NÃO
 * promete prazo — isso fica com as atendentes, no tom delas.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion, type ChatMessage } from "@/lib/caio/openai";
import { enviarTexto, mostrarDigitando } from "./whatsapp";
import { ORG_ID } from "@/lib/caio/config";
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
    : `A loja está FECHADA agora${opts.proximaAbertura ? ` e abre ${opts.proximaAbertura}` : ""}. Quando passar a conversa, diga que estamos fechados, quando abrimos e que uma atendente continua assim que a loja abrir. Com a loja fechada, nunca diga "já vai".`;

  return `Você é ${opts.nomeAssistente}, do atendimento de ${opts.nomeEmpresa} no WhatsApp.

A LOJA: ${opts.nomeEmpresa}, distribuidora e depósito de bebidas em ${opts.cidade}. Isso você sempre pode dizer.

SEU PAPEL: fazer só o PRIMEIRO atendimento. Cumprimentar, entender o que o cliente precisa e deixar a conversa pronta para uma atendente humana continuar. Quem gera o pedido, passa valores e combina a entrega são as atendentes.

COMO ESCREVER (igual às atendentes da loja): frases curtas, educadas e simples. Sem emoji. Fale sempre no plural, em nome da loja ("recebemos", "podemos ajudar", "entregamos"), nunca "recebi" ou "posso". Fale direto com o cliente ("você"), nunca "o cliente". Nunca copie o texto das informações da loja como está: responda com suas palavras. Não repita o que o cliente acabou de dizer. Frases das informações como "não é para todos os clientes" ou "a atendente verifica" são instruções para você agir, não para repetir ao cliente: nesses casos diga só que uma atendente verifica com ele.
CUMPRIMENTO DE AGORA: "Olá, ${opts.saudacao}!". Use exatamente esse cumprimento (nunca outro período do dia). ${opts.respostasJaDadas === 0 ? 'Esta é a PRIMEIRA mensagem da conversa: comece com ele (pode incluir o primeiro nome do cliente, ex.: "Olá, João, ' + opts.saudacao + '!").' : "Não cumprimente de novo."}
${opts.respostasJaDadas === 0 ? `APRESENTAÇÃO (só nesta primeira mensagem): logo depois do cumprimento, diga de onde fala: "Aqui é da ${opts.nomeEmpresa}." Se o cliente perguntou "tudo bem?" ou parecido, responda a gentileza antes de seguir ("Tudo bem por aqui!"); nunca ignore. Ex.: "Olá, ${opts.saudacao}! Aqui é da ${opts.nomeEmpresa}, tudo bem por aqui! Como podemos ajudar?". Quando o cliente já mandou o pedido ou o assunto, a apresentação é curta e o resto segue o caso abaixo.` : ""}

REGRAS QUE NUNCA PODEM SER QUEBRADAS:
1. Nunca informe preço, valor, total, desconto, taxa de entrega, estoque, disponibilidade de produto ou horário/prazo de entrega. Diga que a atendente confirma.
2. Nunca confirme o pedido e nunca diga "anotei". Nunca escreva nenhum produto, marca, número ou quantidade que o cliente mandou: diga apenas "recebemos seu pedido".
3. Nunca invente informação. Só responda uma dúvida se a resposta estiver ESCRITA nas INFORMAÇÕES DA LOJA abaixo (ou for a cidade da loja). Se não estiver escrita, não diga sim nem não: diga que a atendente confirma e passe a conversa.
4. Mensagem curta: no máximo 3 frases curtas (4 na primeira mensagem, por causa da apresentação) e no máximo 1 pergunta. Fale "atendente" no máximo uma vez.
5. Se perguntarem se você é robô ou pessoa, diga com naturalidade que é o assistente virtual de ${opts.nomeEmpresa} e que uma atendente vai continuar o atendimento.

O QUE FAZER EM CADA CASO (os textos entre aspas são modelos de tom; adapte com suas palavras e varie, sem repetir sempre a mesma frase):
- Cliente mandou o pedido (lista de produtos ou quantidades, mesmo que seja um produto só, como "um galão de água"; ou foto, planilha ou arquivo dizendo que é pedido): comece com "Recebemos seu pedido!" e diga que uma atendente gera o pedido e manda para conferir. Depois faça UMA pergunta curta só com o que a equipe sempre precisa e o cliente AINDA NÃO disse:
  - se é para entrega ou retirada (se disser entrega e não tiver dado o endereço, peça o endereço);
  - se quer alguma bebida gelada (só se pediu bebida e não falou se é gelada ou não; nunca pergunte isso para galão de água, gelo ou carvão);
  - para quando (só se não falou dia nem horário).
  Junte numa pergunta só, ex.: "É para entrega ou retirada, e vai querer algo gelado?". Se o cliente já disse tudo isso, não pergunte nada. Nunca pergunte "o que mais você precisa".
  Ex. com a loja aberta: "Recebemos seu pedido! Uma atendente já vai gerar e te mandar para conferir. É para entrega ou retirada, e vai querer algo gelado?"
  Ex. com a loja fechada: "Recebemos seu pedido! Estamos fechados agora e abrimos ${opts.proximaAbertura ?? "no próximo dia útil"}; uma atendente gera o seu pedido assim que a loja abrir. É para entrega ou retirada?"
  assunto = pedido, passar = true.
- Cliente mandou comprovante de pagamento (arquivo ou foto com "comprovante", "pix", "pagamento" ou "recibo" no nome, ou disse "segue o pix", "paguei", "pix feito", "tá pago"): "Recebemos o seu comprovante, obrigado! Uma atendente já confere." Não fale de pedido nem de nota fiscal. assunto = pos_venda, passar = true.
- Foto, vídeo ou arquivo SEM nenhum texto e sem nome que diga o que é: pode ser pedido ou comprovante, então não diga qual: "Recebemos a sua foto! Uma atendente já confere e te responde." (vídeo: "Recebemos o seu vídeo!"; arquivo: "Recebemos o seu arquivo!"). assunto = outro, passar = true.
- Pediu os dados do Pix, a chave Pix ou a conta para pagar: "Uma atendente já te manda os dados do Pix." Não diga as formas de pagamento. assunto = pos_venda, passar = true.
- Cliente quer comprar ou avisou que vai mandar o pedido, mas ainda não disse NENHUM produto ("vou fazer o pedido", "quero comprar"): "Pode mandar o seu pedido!" (ou pergunte o que ele precisa). assunto = pedido, passar = false. Se ele disse pelo menos um produto, é o caso do pedido acima. Quando ele disser, avise que a atendente já vai continuar e passar = true.
- Orçamento para festa ou evento. O orçamento precisa só de duas coisas: a DATA e O QUE precisa (lista de bebidas OU número de pessoas).
  - Antes de perguntar, confira o que o cliente JÁ mandou. Faltando só a data: "Para quando é o evento?". Faltando só o que precisa: "O que você vai precisar, ou para quantas pessoas?". Nunca pergunte o que ele já disse (se falou "80 pessoas", não pergunte quantas pessoas). passar = false.
  - Se já tem as duas (na mensagem atual ou antes): responda só "Recebemos as informações. Uma atendente já vai montar o seu orçamento." Não peça mais nada, não repita data nem lista, nunca peça quantidade de cada item. passar = true.
  - assunto = orcamento.
- Dúvida que as INFORMAÇÕES DA LOJA respondem (horário, endereço, retirada, formas de pagamento): responda com a informação COMPLETA, com todos os itens escritos (ex.: "Aceitamos Pix, dinheiro e cartão."), e termine com "Podemos ajudar em algo mais?". Horário: use os dias exatamente como estão escritos em HORÁRIO, sem resumir nem trocar os dias. assunto = duvida, passar = false.
- Perguntou o que a loja vende, com o que trabalha ou quem somos ("o que vocês trabalham?", "o que vocês vendem?", "vocês são o quê?"): diga o nome da loja e o que vendemos, com os itens escritos em QUEM SOMOS ou O QUE VENDEMOS nas INFORMAÇÕES DA LOJA, numa frase só, e pergunte "Quer fazer um pedido ou um orçamento?". Sem preço, marca ou estoque. Sem informações cadastradas, diga só que somos uma distribuidora de bebidas. assunto = duvida, passar = false.
- Pergunta se entregamos em um bairro ou cidade da região: responda com a área de entrega escrita. Se o cliente não disse a cidade e o bairro pode ser de outra cidade, condicione sem repetir o nome da cidade: "Entregamos em todos os bairros de Americana. Uma atendente confirma o seu endereço com você." Se a cidade for uma das que a atendente confirma, NÃO diga "entregamos em [cidade]": diga só "Uma atendente confirma se entregamos no seu endereço." passar = true quando a atendente precisar confirmar.
- Pergunta sobre preço (mesmo sem "R$", como "ainda tá 45?"), se tem um produto ("tem Fanta de 1 litro?", "chegou o litrão?", "vocês vendem água de coco?"), estoque ou prazo de entrega: "Uma atendente já vai te passar essa informação." assunto = duvida, passar = true. Não fale de localização.
- Pergunta sobre um pedido já feito ("já saiu meu pedido?", "vem até meio-dia?", "pode ser às 13h30?", "vai demorar?"): "Vamos verificar o seu pedido. Uma atendente já te responde." assunto = pos_venda, passar = true.
- Entrega em outro estado ou país (Bahia, Dubai): não diga sim nem não e não diga onde entregamos. Em tom formal: "Estamos localizados em ${opts.cidade}. Uma atendente já vai entrar em contato para te atender melhor." assunto = duvida, passar = true. Nunca "ficamos" ou "somos daqui de".
- Produto ou serviço que claramente não tem nada a ver com bebidas (cafezinho, pão de queijo, roupa): isso é pergunta sobre a loja, não conversa fora do assunto. Não diga sim nem não: "Aqui é da ${opts.nomeEmpresa}, trabalhamos com bebidas em ${opts.cidade}. Uma atendente já vai te responder sobre isso." passar = true.
- Assuntos de depois da venda (nota fiscal, boleto, reembolso, troca, acerto de consignado): diga o que vai ser feito, ex.: "Vamos verificar para você. Uma atendente já te responde." (fale de nota fiscal só se o cliente falou de nota) assunto = pos_venda, passar = true.
- Reclamação (atraso, produto errado ou quente, entregador): peça desculpas primeiro: "Lamentamos muito o ocorrido. Uma atendente já vai falar com você para resolver." assunto = pos_venda, passar = true.
- Cliente pede para falar com uma pessoa ou está irritado: passar = true.
- NA DÚVIDA, ATENDENTE: mensagem que não se encaixa em nenhum caso aqui e que você não sabe responder com certeza (recado, combinação, mudança de algo já combinado): "Recebemos a sua mensagem! Uma atendente já vai te responder." passar = true. Quando você sabe a resposta, responda só a resposta.
- Conversa que CLARAMENTE não tem nada a ver com a loja nem com produtos (futebol, piada, política, clima, perguntas pessoais): não entre no assunto e não fale de localização: "Aqui é o atendimento da ${opts.nomeEmpresa}. Podemos ajudar com algum pedido ou dúvida?" (com a loja fechada, diga também que estamos fechados e quando abrimos). assunto = outro, passar = false.
- LOJA FECHADA e o cliente quer comprar, precisa de algo ou perguntou se abrimos: diga que estamos fechados, quando abrimos e que uma atendente responde assim que a loja abrir. Se ele já mandou o pedido, siga o caso do pedido (com a pergunta de complemento). Se perguntou o horário, diga também o horário escrito em HORÁRIO (ex.: "Funcionamos de segunda a sábado, das 8h às 18h."). Não pergunte "podemos ajudar em algo mais?". passar = true (senão o pedido fica parado e ninguém vê).
- Só um cumprimento ("oi", "bom dia", "tudo bem?"): cumprimente, apresente a loja, responda a gentileza se houver, e pergunte "Como podemos ajudar?". passar = false.
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
  /** Quando a loja abre ("amanhã (segunda-feira) às 08:00"), para avisar com a loja fechada. */
  proximaAbertura?: string | null;
}

/** "80 pessoas", "150 convidados". */
const RE_PESSOAS = /\d+\s*(pessoas|convidados|pessoa)\b/i;
/** "15/11", "dia 20", "sábado que vem", "amanhã". */
const RE_DATA = /\b\d{1,2}\s*\/\s*\d{1,2}\b|\bdia \d{1,2}\b|\b(amanh[ãa]|hoje|depois de amanh[ãa])\b|\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?\b/i;
/** Cliente quer comprar ou precisa de algo. */
const RE_QUER_ALGO = /\b(preciso|precisava|quero|queria|manda|mandar|entrega|entregar|pedido|comprar|tem)\b/i;
/** Cliente dizendo que quer comprar (mais estreito: uma pergunta de entrega ou de produto continua dúvida). */
const RE_QUER_COMPRAR = /\b(preciso|precisava|quero|queria|comprar|pedido)\b/i;

/** Arquivo ou foto de comprovante ("[enviou um arquivo: Comprovante.pdf]", "PIX - LOJA.pdf"). */
const RE_COMPROVANTE_ARQUIVO =
  /\[enviou (um arquivo|uma foto)[^\]]*(comprovante|(?<![a-z])pix(?![a-z])|pagamento|recibo|transfer|sicredi|sicoob|ita[uú]|bradesco|nubank|santander|banco|caixa_|bb_|mercado ?pago|picpay|pagbank|pagseguro|(?<![a-z])inter(?![a-z])|(?<![a-z])c6(?![a-z0-9]))|\[enviou (um arquivo[^\]]*|uma foto)\]\s*(comprovante|pix|pagamento|recibo)\b/i;
/** Cliente pedindo os dados do Pix ("me passa o pix", "qual a chave?"). */
const RE_PEDE_PIX =
  /\b(passa|manda|envia|mande|envie|passe)\b[^.?!\n]{0,15}\b(pix|chave|dados (do|para o|pra) pix|conta)\b|\bqual (a |é a )?chave\b|\bchave (do )?pix\b|\bdados (do|para o|pra) pix\b/i;
/** Cliente avisando que pagou ("segue o pix", "tá pago", "paguei", "já fiz o pix"). Não pega "vou fazer o pix". */
const RE_COMPROVANTE_TEXTO =
  /\b(segue|seguem|anexo|aqui (est[áa]|vai))\b[^.?!\n]{0,12}\b(comprovante|pix|pagamento)\b|\b(fiz|mandei|enviei) o (pix|pagamento|comprovante)\b|\bpix (feito|realizado|efetuado|enviado|pago)\b|\b(t[áa]|est[áa]) pago\b(?!\s*\?)|\bpaguei\b(?!\s*\?)|\bpagamento (feito|realizado|efetuado)\b/i;

/** Mandou só foto (e talvez um "oi"/"boa tarde"): não dá para saber se é pedido ou comprovante. */
export function soFotoSemTexto(textoCliente: string): boolean {
  if (!/\[enviou uma foto\]/i.test(textoCliente)) return false;
  const resto = textoCliente
    .replace(/\[enviou uma foto\]/gi, " ")
    .replace(/\b(oi+e*|ol[áa]|bom dia|boa tarde|boa noite|tudo bem|td bem|tudo bom|segue|meninas?|moça)\b/gi, " ")
    .replace(/[\s?!.,;:]+/g, "");
  return resto.length === 0;
}

/** Cliente mandou comprovante de pagamento. */
export function ehComprovante(textoCliente: string): boolean {
  return RE_COMPROVANTE_ARQUIVO.test(textoCliente) || RE_COMPROVANTE_TEXTO.test(textoCliente);
}

/**
 * Loja fechada: a mensagem que passa a conversa tem que dizer que está fechada e
 * quando abre, e não pode prometer "já vai" (o cliente acha que sai na hora).
 */
export function avisarLojaFechada(resposta: string, proximaAbertura: string | null | undefined): string {
  let r = resposta.replace(/\bj[áa] (vai|confere|te responde|responde)\b/gi, (_m, v: string) => v);
  const frases = r.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((f) => f.trim()).filter(Boolean) ?? [r];
  const i = frases.findIndex((f) => RE_FALA_DE_ATENDENTE.test(f));
  if (i >= 0 && !/abrir|abrirmos|logo cedo|quando abr/i.test(frases[i])) {
    frases[i] = frases[i].replace(/\s*([.!?]+)$/, " assim que a loja abrir$1");
  }
  if (!/fechad|abrimos/i.test(r)) {
    const aviso = `Estamos fechados agora${proximaAbertura ? ` e abrimos ${proximaAbertura}` : ""}.`;
    frases.splice(i >= 0 ? i : frases.length, 0, aviso);
  }
  r = frases.join(" ");
  return r.replace(/\s+/g, " ").trim();
}

/** Resposta genérica de quem não entendeu ("Podemos ajudar com algum pedido ou dúvida?"). */
const RE_RESPOSTA_GENERICA = /podemos ajudar com algum pedido ou d[úu]vida\?|como podemos ajudar\?/i;
/** Assunto claramente fora da loja: aí a resposta genérica serve. */
const RE_FORA_DO_ASSUNTO = /\b(jogo|futebol|time|placar|piada|pol[íi]tic|elei[çc]|presidente|clima|chuva|previs[ãa]o do tempo|hor[óo]scopo|filme|s[ée]rie|novela|namorad|namora)\b/i;
/** Pergunta sobre um pedido já feito. */
const RE_STATUS_PEDIDO =
  /j[áa] saiu|saiu (pra|para) (a )?entrega|vai demorar|demora muito|quando (chega|vem|sai)|que horas (chega|vem|sai|entrega)|vem at[ée]|(pode|d[áa]) (ser|pra) (às|as|at[ée])\s*\d|est[áa] vindo|cad[êe] (o |meu )?pedido|meu pedido/i;
/** Mudança ou cancelamento de algo já combinado ("mudou a data da festa", "quero cancelar"). */
const RE_ALTERACAO = /\b(mud(ou|ar|amos|ei)|alter(ar|ou|ei)|remarc|adiar|adiou|cancel(ar|ei|ou|a))\b/i;
/** Foto ou arquivo que o cliente disse que é o pedido ("[foto] segue o pedido da semana"). */
function pedidoEmAnexo(textoCliente: string): boolean {
  return /\[enviou (uma foto|um arquivo)/i.test(textoCliente) && /\b(pedido|lista)\b/i.test(textoCliente) && !ehComprovante(textoCliente);
}
/** Pergunta se tem um produto. */
const RE_DISPONIBILIDADE = /\b(tem|tinha|teria|chegou|chegaram|vendem|trabalham com|ainda tem|voc[êe]s t[êe]m|vcs tem)\b/i;

/** O cliente só cumprimentou ("oi", "bom dia, tudo bem?"). */
function soCumprimento(textoCliente: string): boolean {
  return (
    textoCliente
      .replace(/\b(oi+e*s?|ol[áa]+|bo[am]+ (dia|tarde|noite)\w*|tudo (bem|bom|certo|joia)|td (bem|bom)|e a[ií]|opa|eae|e voc[êe]|e vc|meninas?|gente|pessoal|mo[çc]a)\b/gi, " ")
      .replace(/[\p{Extended_Pictographic}\s?!.,;:]+/gu, "")
      .length === 0
  );
}

/** Cliente já disse se é entrega ou retirada. */
const RE_ENTREGA_OU_RETIRADA = /\bentreg|\bmand(a|ar|e|em)\b|\blev(a|ar)\b|\benvi(a|ar|e)\b|\bretir|\bbusc(o|ar|amos)\b|\bpego\b|\bpegar\b|\bpass(o|ar) a[ií]\b|\btraz(er)?\b|\btrazer\b/i;
const RE_SO_RETIRADA = /\bretir|\bbusc(o|ar|amos)\b|\bpego\b|\bpegar\b|\bpass(o|ar) a[ií]\b/i;
/** Endereço escrito ("Rua X, 100", "Av. Brasil 50", "rua das palmas 539"). */
const RE_ENDERECO = /\b(rua|r\.|av\.?|avenida|alameda|travessa|estrada|rodovia|pra[çc]a|condom[ií]nio|cond\.?|ch[áa]cara)\s+\S+/i;
/** Cliente já falou da temperatura ("gelada", "sem gelar", "natural"). */
const RE_FALOU_GELADO = /gelad|gelar|\bsem gelo\b|\bnatural\b|\bquente\b|temperatura ambiente/i;
/** Pedido só de coisas que não se gelam (galão, gelo, carvão). */
const RE_NAO_SE_GELA = /gal[ãa]o|gal[õo]es|\bgelo\b|carv[ãa]o|vasilhame|caixa t[ée]rmica|conservadora/i;
const RE_BEBIDA_QUE_GELA =
  /cerveja|latas?\b|lat[ãa]o|long|garrafa|garrafinha|fardos?|\bcx\b|caixas? de|\bks\b|refri|coca|guaran[áa]|fanta|sprite|pepsi|soda|t[ôo]nica|schweppes|suco|energ[ée]tico|red ?bull|monster|skol|brahma|heineken|original|amstel|budweiser|stella|corona|spaten|antarctica|ant[áa]rtica|[áa]gua (com|sem) g[áa]s|h2o|ice\b|vinho|vodka|gin\b|cacha[çc]a|tequila|whisk/i;

/** O cliente mandou itens do pedido (produto, quantidade, foto ou arquivo), não só "quero pedir". */
const RE_TEM_ITEM = new RegExp(`${RE_QUANTIDADE.source}|\\[enviou (uma foto|um arquivo)|${RE_NAO_SE_GELA.source}|${RE_BEBIDA_QUE_GELA.source}`, "i");
/** Arquivo que diz que é pedido ("pedido_restaurante.xlsx", "lista de compras.pdf"). */
const RE_ARQUIVO_DE_PEDIDO = /\[enviou um arquivo:[^\]]*(pedido|lista|compra|or[cç]amento)/i;
/**
 * A pergunta que a equipe sempre faz num pedido, só com o que o cliente AINDA não
 * disse: entrega ou retirada (ou o endereço) e se quer algo gelado. null = já disse tudo.
 */
export function perguntaDoPedido(textoCliente: string): string | null {
  const partes: string[] = [];
  const temEndereco = RE_ENDERECO.test(textoCliente) || /\[enviou a localiza[çc][ãa]o\]/i.test(textoCliente);
  if (!temEndereco) {
    if (!RE_ENTREGA_OU_RETIRADA.test(textoCliente)) partes.push("é para entrega ou retirada");
    else if (!RE_SO_RETIRADA.test(textoCliente)) partes.push("qual o endereço de entrega");
  }
  const soCoisasQueNaoGelam = RE_NAO_SE_GELA.test(textoCliente) && !RE_BEBIDA_QUE_GELA.test(textoCliente);
  if (!RE_FALOU_GELADO.test(textoCliente) && !soCoisasQueNaoGelam) partes.push("vai querer algo gelado");
  if (!partes.length) return null;
  const junto = partes.join(", e ");
  return `${junto[0].toUpperCase()}${junto.slice(1)}?`;
}

/** Fala "atendente" uma vez só: tira as frases seguintes que repetem a promessa. */
export function semAtendenteRepetida(resposta: string): string {
  const frases = resposta.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((f) => f.trim()).filter(Boolean);
  if (!frases) return resposta;
  let viu = false;
  return frases
    .filter((f) => {
      if (!RE_FALA_DE_ATENDENTE.test(f)) return true;
      if (viu) return false;
      viu = true;
      return true;
    })
    .join(" ");
}

/** Cliente pedindo para falar com gente ("quero falar com uma pessoa", "não quero robô"). */
export const RE_PEDE_PESSOA =
  /(falar|conversar|atendimento) com (uma |um |a |o |alg)?\s*(pessoa|humano|gente|atendente|algu[ée]m|vendedor)|n[ãa]o quero (falar com |conversar com )?(rob[ôo]|bot|m[áa]quina|ia\b)|(me )?passa (pra|para) (uma |um |a |o )?(pessoa|humano|atendente|algu[ée]m)|\bquero (uma |um |a |o )?(atendente|pessoa|humano)\b|\b(chama|chame) (uma |um |a |o )?(atendente|pessoa|algu[ée]m)/i;

/** Corrige o período do dia e garante o cumprimento na primeira mensagem; fala no plural. */
export function ajustarTom(texto: string, saudacao: Saudacao, primeira: boolean): string {
  let t = texto.replace(/\b(bom dia|boa tarde|boa noite)\b/gi, (m) => (m[0] === m[0].toUpperCase() ? saudacao[0].toUpperCase() + saudacao.slice(1) : saudacao));
  t = t.replace(/\bRecebi\b/g, "Recebemos").replace(/\brecebi\b/g, "recebemos");
  t = t.replace(/\btudo [óo]timo por aqui\b/gi, (m) => (m[0] === "T" ? "Tudo bem por aqui" : "tudo bem por aqui"));
  t = t.replace(/\bPosso ajudar\b/g, "Podemos ajudar").replace(/\bposso ajudar\b/g, "podemos ajudar");
  t = t.replace(/\b([Oo]) cliente (pode|deve|precisa|consegue)\b/g, (_m, o: string, v: string) => `${o === "O" ? "Você" : "você"} ${v}`);
  if (primeira && !/^\s*ol[áa](?![a-z])/i.test(t)) t = `Olá, ${saudacao}! ${t}`;
  // A apresentação ("Aqui é da Loja.") vem logo depois do cumprimento, nunca no meio ou no fim.
  if (primeira) {
    const cumprimento = t.match(/^\s*ol[áa][^!.]*[!.]\s*/i);
    const apresentacao = t.match(/\s*Aqui é (?:da|do) [^.!?]*[.!]/);
    if (cumprimento && apresentacao && apresentacao.index! > cumprimento[0].length) {
      const semApresentacao = t.slice(0, apresentacao.index) + t.slice(apresentacao.index! + apresentacao[0].length);
      t = `${cumprimento[0].trim()} ${apresentacao[0].trim()} ${semApresentacao.slice(cumprimento[0].length).trim()}`;
    }
  }
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
  const ola = primeira ? `Olá, ${ctx.saudacao}! ` : "";
  const confere = ctx.aberto ? "Uma atendente já confere." : "Uma atendente confere assim que a loja abrir.";
  // Comprovante de pagamento: agradece e passa (nunca "pedido" nem "nota fiscal").
  if (ctx.textoCliente && ehComprovante(ctx.textoCliente)) {
    const eOPedido = d.assunto === "pedido" ? " e o seu pedido" : "";
    return { resposta: `${ola}Recebemos o seu comprovante${eOPedido}, obrigado! ${confere}`, assunto: d.assunto === "pedido" ? "pedido" : "pos_venda", passar: true };
  }
  // Quer os dados do Pix: a atendente manda (o assistente não passa dados de pagamento).
  if (ctx.textoCliente && RE_PEDE_PIX.test(ctx.textoCliente)) {
    const manda = ctx.aberto ? "Uma atendente já te manda os dados do Pix." : "Uma atendente te manda os dados do Pix assim que a loja abrir.";
    return { resposta: `${ola}${manda}`, assunto: ctx.assuntoAnterior ?? "pos_venda", passar: true };
  }
  // Só foto, sem texto: pode ser pedido ou comprovante; não chuta.
  if (ctx.textoCliente && soFotoSemTexto(ctx.textoCliente)) {
    const responde = ctx.aberto ? "Uma atendente já confere e te responde." : "Uma atendente confere e te responde assim que a loja abrir.";
    return { resposta: `${ola}Recebemos a sua foto! ${responde}`, assunto: ctx.assuntoAnterior ?? "outro", passar: true };
  }
  // Pedido com produto já dito: nunca "o que mais você precisa?".
  if (decisao.assunto === "pedido" && /o que mais (voc[êe] )?(precisa|vai querer|deseja)|al[ée]m d[oa] /i.test(decisao.resposta)) {
    decisao = { ...decisao, resposta: `${ola}Recebemos seu pedido! Uma atendente já vai gerar e te mandar para conferir.`, passar: true };
  }
  // Arquivo de pedido ("pedido_restaurante.xlsx"), ou pedido com produto que a IA deixou com o assistente.
  const temItem = !!ctx.textoCliente && RE_TEM_ITEM.test(ctx.textoCliente);
  const arquivoDePedido = !!ctx.textoCliente && (RE_ARQUIVO_DE_PEDIDO.test(ctx.textoCliente) || pedidoEmAnexo(ctx.textoCliente));
  if (arquivoDePedido || (decisao.assunto === "pedido" && !decisao.passar && temItem)) {
    decisao = { resposta: `${ola}Recebemos seu pedido! Uma atendente já vai gerar e te mandar para conferir.`, assunto: "pedido", passar: true };
  }
  // A resposta fala de "foto", mas o cliente mandou vídeo ou arquivo.
  if (ctx.textoCliente && /a sua foto/i.test(decisao.resposta) && !/\[enviou uma foto\]/i.test(ctx.textoCliente)) {
    const qual = /\[enviou um v[íi]deo\]/i.test(ctx.textoCliente) ? "o seu vídeo" : "o seu arquivo";
    decisao = { ...decisao, resposta: decisao.resposta.replace(/a sua foto/i, qual) };
  }
  // Entrega fora de Americana: nunca afirma; a atendente confirma.
  if (decisao.assunto === "duvida" && /\bentregamos\b/i.test(decisao.resposta)) {
    const frases = decisao.resposta.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((f) => f.trim()) ?? [decisao.resposta];
    const ficam = frases.filter((f) => !/\bentregamos\b/i.test(f) || /americana/i.test(f));
    if (ficam.length !== frases.length) {
      const resto = ficam.filter((f) => !RE_FALA_DE_ATENDENTE.test(f));
      decisao = { ...decisao, resposta: [...resto, "Uma atendente confirma se entregamos no seu endereço."].join(" "), passar: true };
    }
  }
  // NA DÚVIDA, ATENDENTE: resposta genérica para quem disse algo da loja (pedido já feito,
  // produto, recado, endereço...) vira "uma atendente já vai te responder".
  if (
    ctx.textoCliente &&
    RE_RESPOSTA_GENERICA.test(decisao.resposta) &&
    !soCumprimento(ctx.textoCliente) &&
    !RE_FORA_DO_ASSUNTO.test(ctx.textoCliente)
  ) {
    const statusPedido = RE_STATUS_PEDIDO.test(ctx.textoCliente);
    const produto = !statusPedido && RE_DISPONIBILIDADE.test(ctx.textoCliente);
    const fim = statusPedido
      ? "Vamos verificar o seu pedido. Uma atendente já te responde."
      : produto
        ? "Uma atendente já vai te passar essa informação."
        : "Recebemos a sua mensagem! Uma atendente já vai te responder.";
    const inicio = decisao.resposta.replace(RE_RESPOSTA_GENERICA, "").replace(/\s*Estamos fechados[^.]*\./i, "").trim();
    decisao = {
      // Se a resposta já diz que a atendente continua, só tira a pergunta genérica.
      resposta: RE_FALA_DE_ATENDENTE.test(inicio) ? inicio : `${inicio || ola.trim()} ${fim}`.trim(),
      assunto: statusPedido ? "pos_venda" : produto ? "duvida" : decisao.assunto,
      passar: true,
    };
  }
  // Respondeu a dúvida e ainda juntou o "recebemos a sua mensagem": fica a resposta.
  const respondeuEJuntou = decisao.resposta.match(/^([\s\S]*\S[.!])\s*Recebemos a sua mensagem! Uma atendente já vai te responder\.$/);
  if (decisao.assunto === "duvida" && respondeuEJuntou) {
    const antes = respondeuEJuntou[1].trim();
    const semApresentacao = antes.replace(/^\s*ol[áa][^!.]*[!.]\s*/i, "").replace(/^\s*Aqui é (?:da|do) [^.!?]*[.!]\s*/i, "").trim();
    if (semApresentacao) decisao = { ...decisao, resposta: `${antes} Podemos ajudar em algo mais?`, passar: false };
  }
  // Mudança ou cancelamento de algo combinado: sempre com uma atendente.
  if (!decisao.passar && ctx.textoCliente && RE_ALTERACAO.test(ctx.textoCliente)) {
    decisao = { ...decisao, resposta: `${ola}Recebemos a sua mensagem! Uma atendente já vai te responder.`, passar: true };
  }
  // "Nota fiscal" só quando o cliente falou de nota.
  if (ctx.textoCliente && /nota fiscal/i.test(decisao.resposta) && !/\bnota|\bnf\b|nfe|cupom/i.test(ctx.textoCliente)) {
    decisao = { ...decisao, resposta: decisao.resposta.replace(/a sua nota fiscal|sua nota fiscal|a nota fiscal/gi, "para você") };
  }
  // Orçamento: o cliente já deu a data; não pergunta de novo.
  if (decisao.assunto === "orcamento" && !decisao.passar && ctx.textoCliente && RE_DATA.test(ctx.textoCliente) && /quando|qual (a )?data/i.test(decisao.resposta)) {
    const fim = RE_PESSOAS.test(ctx.textoCliente) ? "Uma atendente já vai montar o seu orçamento." : "Uma atendente já vai continuar com você.";
    decisao = { ...decisao, resposta: `${ola}Recebemos as informações. ${fim}`, passar: true };
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
  if (decisao.assunto === "duvida" && /\S.*?\s*Como (podemos|posso) (te )?ajudar[^?]*\?\s*$/i.test(semCumprimento) && !/^\s*Como (podemos|posso) (te )?ajudar[^?]*\?\s*$/i.test(semCumprimento)) {
    decisao = { ...decisao, resposta: decisao.resposta.replace(/\s*Como (podemos|posso) (te )?ajudar[^?]*\?\s*$/i, " Podemos ajudar em algo mais?") };
  }
  // Orçamento: não pergunta o que o cliente acabou de dizer.
  if (decisao.assunto === "orcamento" && !decisao.passar && ctx.textoCliente) {
    const temPessoas = RE_PESSOAS.test(ctx.textoCliente);
    const temData = RE_DATA.test(ctx.textoCliente);
    if (temPessoas && temData) {
      decisao = { ...decisao, resposta: `${primeira ? `Olá, ${ctx.saudacao}! ` : ""}Recebemos as informações. Uma atendente já vai montar o seu orçamento.`, passar: true };
    } else if (temPessoas && /quantas pessoas|quantos convidados/i.test(decisao.resposta)) {
      decisao = { ...decisao, resposta: `${primeira ? `Olá, ${ctx.saudacao}! ` : ""}Para quando é o evento?` };
    }
  }
  // Loja fechada: qualquer assunto da loja vai para a fila, para a atendente ver quando abrir.
  // Cliente que quer algo é pedido, mesmo que a IA já tenha passado a conversa.
  if (!ctx.aberto && decisao.assunto === "outro" && ctx.textoCliente && RE_QUER_ALGO.test(ctx.textoCliente)) {
    decisao = { ...decisao, assunto: "pedido" };
  }
  if (!ctx.aberto && decisao.assunto === "duvida" && ctx.textoCliente && RE_QUER_COMPRAR.test(ctx.textoCliente)) {
    decisao = { ...decisao, assunto: "pedido" };
  }
  // Loja fechada e a conversa fica com o assistente (oi, assunto fora da loja): avisa que está fechada.
  if (!ctx.aberto && !decisao.passar && decisao.assunto === "outro" && !/fechad/i.test(decisao.resposta)) {
    const aviso = `Estamos fechados agora${ctx.proximaAbertura ? ` e abrimos ${ctx.proximaAbertura}` : ""}.`;
    const pergunta = decisao.resposta.match(/[^.!?]*\?\s*$/);
    decisao = {
      ...decisao,
      resposta: pergunta
        ? `${decisao.resposta.slice(0, pergunta.index).trim()} ${aviso} ${pergunta[0].trim()}`.trim()
        : `${decisao.resposta} ${aviso}`.trim(),
    };
  }
  if (!ctx.aberto && !decisao.passar && decisao.assunto !== "outro") decisao = { ...decisao, passar: true };
  // Falou em atendente: a conversa TEM que ir para a fila (senão ninguém é avisado).
  if (!decisao.passar && RE_FALA_DE_ATENDENTE.test(decisao.resposta)) decisao = { ...decisao, passar: true };
  // Conversa está rodando demais com o assistente: a próxima palavra é da atendente.
  if (!decisao.passar && ctx.respostasJaDadas + 1 >= MAX_RESPOSTAS_ASSISTENTE) decisao = { ...decisao, passar: true };
  // Vai para a fila: não termina com pergunta ao cliente e sempre avisa que uma atendente continua.
  if (decisao.passar) {
    let r = decisao.resposta.replace(/\s*(Como )?(Podemos|Posso) (te )?ajudar[^?]*\?\s*$/i, "").trim();
    // Pedido com produtos: a pergunta de complemento é do código (só o que falta), não da IA.
    const complemento = decisao.assunto === "pedido" && ctx.textoCliente && RE_TEM_ITEM.test(ctx.textoCliente);
    if (complemento) r = (r.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [r]).map((f) => f.trim()).filter((f) => !f.endsWith("?")).join(" ");
    if (!RE_FALA_DE_ATENDENTE.test(r)) {
      const fim = decisao.assunto === "pedido" && complemento ? "Uma atendente já vai gerar e te mandar para conferir." : "Uma atendente já vai falar com você.";
      r = `${r} ${ctx.aberto ? fim : "Uma atendente te responde assim que a loja abrir."}`.trim();
    }
    r = semAtendenteRepetida(r);
    if (!ctx.aberto) r = avisarLojaFechada(r, ctx.proximaAbertura);
    if (complemento) {
      const pergunta = perguntaDoPedido(ctx.textoCliente!);
      if (pergunta) r = `${r} ${pergunta}`;
    }
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
    .map((m) => descreverMensagem(m))
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
    proximaAbertura: proximaAbertura(cfg, agora),
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
  // Com a loja fechada não tem pressa: espera o cliente terminar a lista (tem gente que
  // manda um item por mensagem, ao longo de alguns minutos, de madrugada).
  const { data: org } = await admin.from("organizations").select("atendimento_config").eq("id", ORG_ID).maybeSingle();
  const fechada = !estaAberto(normalizarConfig(org?.atendimento_config), new Date());
  const esperaMs = fechada ? 40000 + Math.floor(Math.random() * 10000) : 8000 + Math.floor(Math.random() * 4000);
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
