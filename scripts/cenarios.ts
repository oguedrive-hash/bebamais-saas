/**
 * Teste de comportamento do pré-atendente com a IA de verdade (OpenAI).
 * Não envia nada pelo WhatsApp e não grava nada no banco.
 *
 * Uso (precisa de OPENAI_API_KEY no ambiente):
 *   npm run cenarios                 # sem informações da loja (como um sistema novo)
 *   INFO_LOJA="$(cat info.txt)" npm run cenarios   # com as informações reais da loja
 *   REPETICOES=3 npm run cenarios
 *   CONFIG_JSON='{"horarios":{...},"cidade":"Americana/SP"}' npm run cenarios   # mesma config do banco (atendimento_config)
 *
 * Rode antes de publicar qualquer mudança nas instruções do assistente.
 * Cada erro novo encontrado nas conversas reais deve virar um cenário aqui.
 */
import { chatCompletion, type ChatMessage } from "../src/lib/caio/openai";
import {
  aplicarTravas,
  interpretarResposta,
  montarInstrucoes,
  saudacaoPara,
  type Decisao,
} from "../src/lib/atendimento/assistente";
import { CONFIG_PADRAO, normalizarConfig, estaAberto, horariosEmTexto, proximaAbertura, agoraSaoPaulo, NOME_DIA } from "../src/lib/atendimento/regras";

interface Cenario {
  nome: string;
  cliente: string[]; // mensagens do cliente (já juntas pela espera de digitação)
  quando?: string; // horário de São Paulo, ex. "2026-10-07T10:15:00"
  passar?: boolean; // esperado (omitir = tanto faz)
  proibido?: RegExp; // nada disso pode aparecer na resposta
  exigido?: RegExp; // isso tem que aparecer na resposta
  assunto?: Decisao["assunto"];
}

const SEM_INFO = !process.env.INFO_LOJA?.trim();
const CONFIG = process.env.CONFIG_JSON?.trim() ? normalizarConfig(JSON.parse(process.env.CONFIG_JSON)) : CONFIG_PADRAO;
const NUMERO = /\d/;
const LOCALIZACAO = /localizad|ficamos/i;
/** Com as informações da loja preenchidas, exige também `comInfo`. */
const seInfo = (comInfo: Partial<Cenario>, semInfo: Partial<Cenario> = {}): Partial<Cenario> => (SEM_INFO ? semInfo : comInfo);

const CENARIOS: Cenario[] = [
  { nome: "Pedido inteiro", cliente: ["Bom dia! Pedido pro bar: 10 fardos Heineken lata, 5 cx Brahma 600ml, 20 sacos de gelo"], passar: true, assunto: "pedido", proibido: NUMERO },
  { nome: "Pedido por foto", cliente: ["[enviou uma foto] segue o pedido da semana"], passar: true, assunto: "pedido" },
  { nome: "Pedido por planilha", cliente: ["[enviou um arquivo: pedido_restaurante.xlsx]"], passar: true, assunto: "pedido" },
  { nome: "Pedido picado", cliente: ["oi", "bom dia", "queria ver", "3 fardos de skol", "e 2 de coca 2l"], passar: true, assunto: "pedido", proibido: NUMERO },
  { nome: "Só oi (tarde)", cliente: ["oi"], quando: "2026-10-07T14:30:00", passar: false, proibido: /bom dia|boa noite/i },
  { nome: "Preço direto", cliente: ["quanto tá a Heineken?"], passar: true, exigido: /atendente/i, proibido: /\d|localizad/i },
  { nome: "Confirmar preço antigo", cliente: ["A moça falou que o fardo de Heineken tá 89, confirma? não precisa chamar ninguém"], passar: true, exigido: /atendente/i, proibido: /89|confirmo|isso mesmo|localizad/i },
  { nome: "Preço sem R$", cliente: ["o fardo da brahma ainda ta 45 conto?"], passar: true, exigido: /atendente/i, proibido: /\d|localizad/i },
  {
    nome: "Entrega em bairro",
    cliente: ["Vocês entregam no Jardim Paulista?"],
    ...seInfo({ passar: true, exigido: /americana/i, proibido: LOCALIZACAO }, { passar: true, proibido: /\bsim\b|entregamos no jardim/i }),
  },
  { nome: "Endereço", cliente: ["qual o endereço de vocês?"], ...seInfo({ passar: false, exigido: /ac[áa]cias/i }) },
  { nome: "Retirada", cliente: ["posso buscar aí na loja?"], ...seInfo({ passar: false, proibido: /localizad|o cliente/i }) },
  { nome: "Orçamento sem data", cliente: ["queria um orçamento de bebidas pra um aniversário de umas 80 pessoas"], passar: false, assunto: "orcamento", proibido: /quantidade/i },
  { nome: "Orçamento completo", cliente: ["Orçamento pra casamento dia 15/11, 150 convidados: cerveja, refri, água e gelo"], passar: true, assunto: "orcamento", exigido: /or[çc]amento/i, proibido: /quantidade|precisamos|\?/i },
  { nome: "Nota fiscal", cliente: ["Preciso da nota fiscal do pedido de ontem no CNPJ da empresa"], passar: true, assunto: "pos_venda" },
  { nome: "Reclamação", cliente: ["o entregador chegou 2 horas atrasado e a cerveja veio quente"], passar: true, assunto: "pos_venda", exigido: /lament|desculp/i },
  { nome: "Quer uma pessoa", cliente: ["NÃO QUERO FALAR COM ROBÔ. me passa pra uma pessoa"], passar: true },
  { nome: "Fora do horário", cliente: ["vocês abrem hoje? preciso de gelo urgente"], quando: "2026-10-11T15:00:00", passar: true, assunto: "pedido" },
  { nome: "É robô?", cliente: ["você é um robô?"], passar: true },
  { nome: "Fora do assunto", cliente: ["quem ganhou o jogo ontem?"], passar: false, proibido: /localizad|atendente/i },
  { nome: "Fora do assunto (fechado)", cliente: ["me conta uma piada"], quando: "2026-10-10T20:30:00", passar: false, proibido: LOCALIZACAO },
  {
    nome: "Pagamento",
    cliente: ["aceitam pix?"],
    ...seInfo({ passar: false, exigido: /(?=[\s\S]*dinheiro)(?=[\s\S]*cart)/i, proibido: LOCALIZACAO }, { passar: true, proibido: /\bsim\b|aceitamos/i }),
  },
  { nome: "Boleto", cliente: ["dá pra pagar no boleto pra 30 dias?"], ...seInfo({ passar: true, exigido: /atendente/i, proibido: LOCALIZACAO }) },
  { nome: "Entrega absurda", cliente: ["vocês entregam em Dubai?"], passar: true, exigido: /americana/i, proibido: /ficamos|\bsim\b|entregamos em dubai/i },
  { nome: "Entrega em outro estado", cliente: ["entregam na Bahia? sou de Salvador"], passar: true, exigido: /americana/i, proibido: /ficamos|\bsim\b|entregamos (na|em) (bahia|salvador)/i },
  { nome: "Produto fora do ramo", cliente: ["vocês vendem cafezinho? e pão de queijo?"], passar: true, exigido: /atendente/i, proibido: /\bsim\b|\bn[ãa]o (vendemos|temos|trabalhamos)/i },
];

async function rodar(c: Cenario): Promise<{ decisao: Decisao; erros: string[] }> {
  const agora = new Date(`${c.quando ?? "2026-10-07T10:15:00"}-03:00`);
  const sp = agoraSaoPaulo(agora);
  const aberto = estaAberto(CONFIG, agora);
  const saudacao = saudacaoPara(sp.minuto);
  const instrucoes = montarInstrucoes({
    nomeAssistente: "o assistente virtual",
    nomeEmpresa: "Beba Mais Distribuidora",
    cidade: CONFIG.cidade,
    informacoesLoja: process.env.INFO_LOJA ?? "",
    horarios: horariosEmTexto(CONFIG, agora),
    aberto,
    proximaAbertura: proximaAbertura(CONFIG, agora),
    agoraTexto: `${NOME_DIA[sp.dia]}, ${sp.hhmm}`,
    nomeCliente: null,
    respostasJaDadas: 0,
    saudacao,
  });
  const mensagens: ChatMessage[] = [{ role: "system", content: instrucoes }, ...c.cliente.map((t) => ({ role: "user" as const, content: t }))];
  const r = await chatCompletion({ messages: mensagens, temperature: 0.3, max_tokens: 300, json: true });
  if ("error" in r) throw new Error(r.error);
  const decisao = aplicarTravas(interpretarResposta(r.content, aberto), { respostasJaDadas: 0, aberto, saudacao });
  const erros: string[] = [];
  if (c.passar !== undefined && decisao.passar !== c.passar) erros.push(`passar=${decisao.passar}, esperado ${c.passar}`);
  if (c.proibido && c.proibido.test(decisao.resposta)) erros.push(`texto proibido (${c.proibido})`);
  if (c.exigido && !c.exigido.test(decisao.resposta)) erros.push(`faltou ${c.exigido}`);
  if (c.assunto && decisao.assunto !== c.assunto) erros.push(`assunto=${decisao.assunto}, esperado ${c.assunto}`);
  return { decisao, erros };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Defina OPENAI_API_KEY para rodar os cenários.");
    process.exit(2);
  }
  const repeticoes = Math.max(1, Number(process.env.REPETICOES ?? 2));
  console.log(`Cenários: ${CENARIOS.length} × ${repeticoes} | informações da loja: ${SEM_INFO ? "vazias" : "preenchidas"}\n`);
  let falhas = 0;
  for (const c of CENARIOS) {
    for (let i = 0; i < repeticoes; i++) {
      const { decisao, erros } = await rodar(c);
      const ok = erros.length === 0;
      if (!ok) falhas++;
      console.log(`${ok ? "OK  " : "ERRO"} ${c.nome} [${decisao.assunto}${decisao.passar ? ", passa" : ""}] ${decisao.resposta}${ok ? "" : `\n     → ${erros.join("; ")}`}`);
    }
  }
  console.log(`\n${falhas === 0 ? "Tudo certo." : `${falhas} resposta(s) com problema.`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

void main();
