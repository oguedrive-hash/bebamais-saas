/**
 * Worker do AQUECEDOR (maturação de chip). Roda no cron `/api/cron/aquecimento`.
 *
 * Faz os números da tabela `aquecimento_numeros` conversarem entre si — papo casual
 * variado por IA, com "digitando", delays humanos e volume subindo por rampa — pra
 * maturar chip novo antes de receber lead real.
 *
 * Papéis: `ancora` (já maduro, IA off, só serve de parceiro) e `aquecendo` (novo).
 * O worker dirige AMBOS os lados da conversa (todos são instâncias da Evolution que
 * a gente controla), alternando quem inicia pra reply-ratio saudável dos dois lados.
 *
 * ISOLADO do lead: quando um número de aquecimento manda msg pro número do Caio,
 * o webhook chama `ehInboundAquecimento()` e PULA o fluxo do Caio (sem loop bot↔bot).
 * É o que permite o esquema duplo (atender lead + aquecer ao mesmo tempo).
 *
 * Anti-ban: conteúdo SEMPRE variado, só horário humano, pausa número que cai/restringe.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  evoSendText,
  evoSendPresence,
  evoConnectionState,
} from "@/lib/caio/evolution-api";
import { chatCompletion } from "@/lib/caio/openai";

type AqNumero = {
  id: string;
  organization_id: string;
  instance_name: string;
  numero: string | null;
  apelido: string | null;
  papel: "ancora" | "aquecendo";
  estado: string;
  aquecimento_inicio: string;
  alvo_diario: number | null;
  falhas_seguidas: number;
};

const MAX_FALHAS = 3; // envios falhando seguidos → pausa o número
const HORA_INICIO = 8; // só aquece entre 8h e 22h (America/Sao_Paulo)
const HORA_FIM = 22;
const TROCAS_POR_TICK = 2; // teto de trocas por execução do cron (espalha o volume)

const BANCO_FALLBACK = [
  "Opa, tudo certo por aí?",
  "E aí, como foi o dia?",
  "Bom dia! Dormiu bem?",
  "Viu o jogo ontem?",
  "Tá calor demais hoje, hein",
  "Já almoçou?",
  "Que semana corrida essa",
  "Bora marcar um café qualquer dia",
  "Tudo tranquilo contigo?",
  "Fim de semana foi bom?",
  "Cara, que sono hoje kkk",
  "Pegou trânsito hoje?",
  "Tô precisando de férias já",
  "Como tá a família?",
  "Acabou de chegar em casa?",
  "Comeu o quê de bom?",
];

function rand(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Rampa de volume diário por número, por dias desde o início do aquecimento. */
export function alvoDiario(dias: number): number {
  if (dias <= 2) return 8; // berço
  if (dias <= 6) return 20; // subida
  if (dias <= 13) return 38; // reta
  return 48; // manutenção
}

/** Medidor do painel: frio → esquentando → quente, derivado dos dias. */
export function temperatura(dias: number): "frio" | "esquentando" | "quente" {
  if (dias < 4) return "frio";
  if (dias < 14) return "esquentando";
  return "quente";
}

export function diasAquecendo(inicio: string): number {
  return Math.floor((Date.now() - new Date(inicio).getTime()) / 86_400_000);
}

/** Hora local de São Paulo (0-23), robusto independente do TZ do processo. */
function horaSP(): number {
  const s = new Date().toLocaleString("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  });
  const h = parseInt(s, 10);
  return Number.isFinite(h) ? h % 24 : new Date().getHours();
}

async function gerarMsg(replyA?: string): Promise<string> {
  const sys =
    "Você gera UMA mensagem curta e natural de conversa casual no WhatsApp, em português do Brasil, como uma pessoa real falando com um conhecido. Varie MUITO o assunto (trabalho, dia, fim de semana, futebol, comida, clima, planos, família, séries). 1 frase curta. NÃO se apresente, NÃO venda nada, NÃO soe robótico. Pode usar gíria leve e no máximo 1 emoji.";
  const user = replyA
    ? `Responda de forma natural e curta a esta mensagem, como num papo casual: "${replyA}"`
    : "Gere uma mensagem de abertura casual de papo no WhatsApp.";
  try {
    const r = await chatCompletion({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 1.05,
      max_tokens: 60,
    });
    if ("error" in r || !r.content?.trim())
      return BANCO_FALLBACK[rand(0, BANCO_FALLBACK.length)];
    return r.content
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .slice(0, 200);
  } catch {
    return BANCO_FALLBACK[rand(0, BANCO_FALLBACK.length)];
  }
}

/** Envia de uma instância pra um número, com "digitando..." + delay humano. */
async function enviarComDigitando(
  deInstance: string,
  paraNumero: string,
  texto: string,
): Promise<{ id: string } | { error: string }> {
  const ms = Math.min(9000, Math.max(2500, texto.length * 130));
  try {
    await evoSendPresence({
      instance: deInstance,
      telefone: paraNumero,
      presence: "composing",
      delayMs: ms,
    });
  } catch {
    /* presença é fire-and-forget */
  }
  await sleep(ms);
  return evoSendText({ instance: deInstance, telefone: paraNumero, texto });
}

type Db = ReturnType<typeof createAdminClient>;

async function contarHoje(supabase: Db, instance: string): Promise<number> {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("aquecimento_log")
    .select("id", { count: "exact", head: true })
    .or(`de_instance.eq.${instance},para_instance.eq.${instance}`)
    .gte("created_at", inicio.toISOString());
  return count ?? 0;
}

async function logar(
  supabase: Db,
  orgId: string,
  de: string,
  paraInstance: string,
  paraNumero: string | null,
) {
  await supabase.from("aquecimento_log").insert({
    organization_id: orgId,
    de_instance: de,
    para_instance: paraInstance,
    para_numero: paraNumero,
    tipo: "text",
  });
}

async function registrarFalha(supabase: Db, n: AqNumero) {
  const falhas = (n.falhas_seguidas ?? 0) + 1;
  const update: Record<string, unknown> = {
    falhas_seguidas: falhas,
    ultimo_erro_em: new Date().toISOString(),
  };
  if (falhas >= MAX_FALHAS) {
    update.estado = "pausado"; // pausa sozinho; usuário reativa no painel
    console.warn(
      `[aquecimento] ${n.apelido ?? n.instance_name} pausado (${falhas} falhas seguidas)`,
    );
  }
  await supabase.from("aquecimento_numeros").update(update).eq("id", n.id);
}

async function zerarFalha(supabase: Db, n: AqNumero) {
  if ((n.falhas_seguidas ?? 0) > 0) {
    await supabase
      .from("aquecimento_numeros")
      .update({ falhas_seguidas: 0 })
      .eq("id", n.id);
  }
}

export async function processarAquecimento(): Promise<{
  ativos: number;
  trocas: number;
}> {
  const hora = horaSP();
  if (hora < HORA_INICIO || hora >= HORA_FIM) {
    console.log(`[aquecimento] fora do horário humano (${hora}h) — pulando`);
    return { ativos: 0, trocas: 0 };
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("aquecimento_numeros")
    .select(
      "id, organization_id, instance_name, numero, apelido, papel, estado, aquecimento_inicio, alvo_diario, falhas_seguidas",
    )
    .eq("ativo", true)
    .eq("estado", "ativo");
  const todos = (data ?? []) as AqNumero[];
  if (!todos.length) return { ativos: 0, trocas: 0 };

  // Checa conexão de cada um; quem não está "open" vira `caido` e sai da rodada.
  const abertos: AqNumero[] = [];
  for (const n of todos) {
    const st = await evoConnectionState(n.instance_name);
    if (st === "open") {
      abertos.push(n);
    } else {
      await supabase
        .from("aquecimento_numeros")
        .update({
          status_conexao: st,
          estado: "caido",
          ultimo_check_em: new Date().toISOString(),
        })
        .eq("id", n.id);
      console.log(`[aquecimento] ${n.apelido ?? n.instance_name} caido (${st})`);
    }
  }

  const aquecendo = abertos.filter((n) => n.papel === "aquecendo");
  const horasJanela = HORA_FIM - HORA_INICIO;

  let trocas = 0;
  for (const W of aquecendo) {
    if (trocas >= TROCAS_POR_TICK) break;

    const dias = diasAquecendo(W.aquecimento_inicio);
    const alvo = W.alvo_diario ?? alvoDiario(dias);
    const feito = await contarHoje(supabase, W.instance_name);
    if (feito >= alvo) continue;

    // Pacing: espalha o alvo nas horas humanas — só envia se está atrás do esperado.
    const esperado = Math.ceil(
      alvo * Math.min(1, (hora - HORA_INICIO + 1) / horasJanela),
    );
    if (feito >= esperado) continue;

    // Re-checa o pause AGORA (não só no próximo tick): pausar mata na hora.
    const { data: vivo } = await supabase
      .from("aquecimento_numeros")
      .select("estado, ativo")
      .eq("id", W.id)
      .maybeSingle();
    const v = vivo as { estado?: string; ativo?: boolean } | null;
    if (!v || v.estado !== "ativo" || v.ativo === false) {
      console.log(`[aquecimento] ${W.apelido ?? W.instance_name} pausado no meio do tick — parando`);
      break;
    }

    // Parceiro = SÓ ÂNCORA conectada. Regra: âncora só RESPONDE aquecendo; aquecendo
    // não conversa com aquecendo, âncora não conversa com âncora, ninguém fala grupo.
    const anc = abertos.filter(
      (p) => p.papel === "ancora" && p.instance_name !== W.instance_name && p.numero,
    );
    if (!anc.length) {
      console.log(
        `[aquecimento] ${W.apelido ?? W.instance_name}: sem âncora conectada — adicione uma âncora`,
      );
      continue;
    }
    const P = anc[rand(0, anc.length)];

    // O número AQUECENDO sempre INICIA; a âncora SÓ RESPONDE (nunca puxa papo).
    const rem = W;
    const dst = P;

    const msg1 = await gerarMsg();
    const r1 = await enviarComDigitando(rem.instance_name, dst.numero!, msg1);
    if ("error" in r1) {
      await registrarFalha(supabase, rem);
      continue;
    }
    await zerarFalha(supabase, rem);
    await logar(supabase, W.organization_id, rem.instance_name, dst.instance_name, dst.numero);
    trocas++;

    // Resposta do outro lado (bidirecional).
    await sleep(rand(4000, 11000));
    const msg2 = await gerarMsg(msg1);
    const r2 = await enviarComDigitando(dst.instance_name, rem.numero!, msg2);
    if ("error" in r2) {
      await registrarFalha(supabase, dst);
    } else {
      await zerarFalha(supabase, dst);
      await logar(supabase, W.organization_id, dst.instance_name, rem.instance_name, rem.numero);
    }
    console.log(
      `[aquecimento] ${W.apelido ?? W.instance_name} dia ${dias} alvo ${alvo} feitoHoje ${feito} (+troca com ${P.apelido ?? P.instance_name})`,
    );
  }

  return { ativos: aquecendo.length, trocas };
}

/**
 * Chamado pelo webhook da Evolution: decide se um inbound é tráfego de AQUECIMENTO
 * (e portanto NÃO deve disparar o Caio). É o filtro que viabiliza o esquema duplo.
 *
 * Pula o Caio se:
 *  - o REMETENTE é um número de aquecimento (âncora/aquecendo manda pro Caio), OU
 *  - o RECEPTOR é uma instância de aquecimento que NÃO atende lead (número puro de warmup).
 */
export async function ehInboundAquecimento(opts: {
  organizationId: string;
  instanceReceptor: string;
  numeroRemetente: string;
  receptorAtendeLead: boolean;
}): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("aquecimento_numeros")
      .select("instance_name, numero")
      .eq("organization_id", opts.organizationId)
      .eq("ativo", true);
    const rows = (data ?? []) as { instance_name: string; numero: string | null }[];
    if (!rows.length) return false;

    const remetenteEhAquecimento = rows.some(
      (r) => r.numero && r.numero === opts.numeroRemetente,
    );
    if (remetenteEhAquecimento) return true;

    const receptorEhAquecimento = rows.some(
      (r) => r.instance_name === opts.instanceReceptor,
    );
    if (receptorEhAquecimento && !opts.receptorAtendeLead) return true;

    return false;
  } catch (e) {
    // Em dúvida, NÃO bloqueia o lead (fail-open pro fluxo de receita).
    console.warn(
      "[aquecimento] ehInboundAquecimento erro:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}
