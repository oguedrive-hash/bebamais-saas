/**
 * Regras do atendimento — funções PURAS (sem banco, sem rede), testáveis.
 *
 * Fluxo de um cliente:
 *   bot ──(assistente passa a conversa)──▶ aguardando ──(atendente pega)──▶ atendendo ──(finaliza)──▶ finalizado
 *    ▲                                                                                                │
 *    └──────────── nova mensagem depois de finalizado, ou depois de X horas parado ◀──────────────────┘
 */

export type AtendStatus = "bot" | "aguardando" | "atendendo" | "finalizado";
export type Assunto = "pedido" | "orcamento" | "duvida" | "pos_venda" | "outro";

export type DiaSemana = "dom" | "seg" | "ter" | "qua" | "qui" | "sex" | "sab";
export const DIAS: DiaSemana[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
export const NOME_DIA: Record<DiaSemana, string> = {
  dom: "domingo",
  seg: "segunda-feira",
  ter: "terça-feira",
  qua: "quarta-feira",
  qui: "quinta-feira",
  sex: "sexta-feira",
  sab: "sábado",
};

export interface Horario {
  abre: string; // "08:00"
  fecha: string; // "18:00"
}

export interface AtendimentoConfig {
  horarios: Record<DiaSemana, Horario | null>;
  /** Minutos esperando atendente até cada mensagem de espera (ex.: [5, 15]). */
  espera_minutos: number[];
  /** Conversa parada há mais que isso volta para o assistente na próxima mensagem. */
  reiniciar_apos_horas: number;
  /** Liga/desliga o assistente para a empresa toda. */
  assistente_ativo: boolean;
}

export const CONFIG_PADRAO: AtendimentoConfig = {
  horarios: {
    dom: null,
    seg: { abre: "08:00", fecha: "18:00" },
    ter: { abre: "08:00", fecha: "18:00" },
    qua: { abre: "08:00", fecha: "18:00" },
    qui: { abre: "08:00", fecha: "18:00" },
    sex: { abre: "08:00", fecha: "18:00" },
    sab: { abre: "08:00", fecha: "13:00" },
  },
  espera_minutos: [5, 15],
  reiniciar_apos_horas: 6,
  assistente_ativo: true,
};

/** Mescla o que veio do banco com o padrão (campos ausentes/errados viram padrão). */
export function normalizarConfig(raw: unknown): AtendimentoConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AtendimentoConfig>;
  const horarios = { ...CONFIG_PADRAO.horarios };
  if (r.horarios && typeof r.horarios === "object") {
    for (const d of DIAS) {
      const h = (r.horarios as Record<string, unknown>)[d];
      if (h === null) horarios[d] = null;
      else if (h && typeof h === "object" && horaValida((h as Horario).abre) && horaValida((h as Horario).fecha)) {
        horarios[d] = { abre: (h as Horario).abre, fecha: (h as Horario).fecha };
      }
    }
  }
  const espera = Array.isArray(r.espera_minutos)
    ? r.espera_minutos.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    : CONFIG_PADRAO.espera_minutos;
  const reiniciar = Number(r.reiniciar_apos_horas);
  return {
    horarios,
    espera_minutos: espera.slice(0, 3),
    reiniciar_apos_horas: Number.isFinite(reiniciar) && reiniciar > 0 ? reiniciar : CONFIG_PADRAO.reiniciar_apos_horas,
    assistente_ativo: r.assistente_ativo !== false,
  };
}

export function horaValida(h: unknown): h is string {
  return typeof h === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
}

function minutos(h: string): number {
  const [hh, mm] = h.split(":").map(Number);
  return hh * 60 + mm;
}

/** Dia da semana e minuto do dia no horário de São Paulo. */
export function agoraSaoPaulo(agora: Date): { dia: DiaSemana; minuto: number; hhmm: string } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const wd = partes.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hh = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(partes.find((p) => p.type === "minute")?.value ?? "0");
  const mapa: Record<string, DiaSemana> = { Sun: "dom", Mon: "seg", Tue: "ter", Wed: "qua", Thu: "qui", Fri: "sex", Sat: "sab" };
  return { dia: mapa[wd] ?? "seg", minuto: hh * 60 + mm, hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

export function estaAberto(cfg: AtendimentoConfig, agora: Date): boolean {
  const { dia, minuto } = agoraSaoPaulo(agora);
  const h = cfg.horarios[dia];
  if (!h) return false;
  return minuto >= minutos(h.abre) && minuto < minutos(h.fecha);
}

/** "hoje às 08:00", "amanhã (sábado) às 08:00", "segunda-feira às 08:00". */
export function proximaAbertura(cfg: AtendimentoConfig, agora: Date): string | null {
  const { dia, minuto } = agoraSaoPaulo(agora);
  const idx = DIAS.indexOf(dia);
  for (let i = 0; i < 8; i++) {
    const d = DIAS[(idx + i) % 7];
    const h = cfg.horarios[d];
    if (!h) continue;
    if (i === 0 && minuto >= minutos(h.abre)) continue; // hoje já abriu (ou já passou)
    if (i === 0) return `hoje às ${h.abre}`;
    if (i === 1) return `amanhã (${NOME_DIA[d]}) às ${h.abre}`;
    return `${NOME_DIA[d]} às ${h.abre}`;
  }
  return null;
}

/** Texto legível dos horários, para o assistente responder "que horas vocês abrem?". */
export function horariosEmTexto(cfg: AtendimentoConfig): string {
  return DIAS.map((d) => {
    const h = cfg.horarios[d];
    return `${NOME_DIA[d]}: ${h ? `${h.abre} às ${h.fecha}` : "fechado"}`;
  }).join("; ");
}

export interface LeadEstado {
  atend_status: AtendStatus;
  ultima_atividade_em: string | null; // última mensagem (de qualquer lado)
  caio_ativo: boolean; // liga/desliga do assistente NESTA conversa
}

export interface DecisaoEntrada {
  /** Começa uma conversa nova (zera assunto, atribuição, contadores). */
  novaConversa: boolean;
  /** Estado depois de registrar a mensagem. */
  status: AtendStatus;
  /** O assistente deve responder esta mensagem. */
  assistenteResponde: boolean;
}

/**
 * O que acontece quando o CLIENTE manda uma mensagem.
 * - finalizado, ou parado há mais de `reiniciar_apos_horas` → conversa nova, volta para o assistente.
 * - bot → o assistente responde.
 * - aguardando / atendendo → a mensagem só aparece no painel; o assistente fica quieto.
 */
export function decidirEntrada(
  lead: LeadEstado,
  cfg: AtendimentoConfig,
  agora: Date,
  numeroComAssistente: boolean,
): DecisaoEntrada {
  const parado =
    !lead.ultima_atividade_em ||
    agora.getTime() - new Date(lead.ultima_atividade_em).getTime() > cfg.reiniciar_apos_horas * 3600_000;
  const novaConversa = lead.atend_status === "finalizado" || parado;
  const status: AtendStatus = novaConversa ? "bot" : lead.atend_status;
  const assistenteLigado = cfg.assistente_ativo && numeroComAssistente && (novaConversa || lead.caio_ativo);
  if (status === "bot" && !assistenteLigado) {
    // Sem assistente: vai direto para a fila das atendentes.
    return { novaConversa, status: "aguardando", assistenteResponde: false };
  }
  return { novaConversa, status, assistenteResponde: status === "bot" };
}

/** Limite de respostas do assistente por conversa: passou disso, vai para a atendente. */
export const MAX_RESPOSTAS_ASSISTENTE = 3;

/** Qual mensagem de espera mandar agora (índice), ou null se nenhuma. */
export function avisoDeEsperaDevido(
  aguardandoDesde: string | null,
  avisosJaEnviados: number,
  cfg: AtendimentoConfig,
  agora: Date,
): number | null {
  if (!aguardandoDesde) return null;
  if (avisosJaEnviados >= cfg.espera_minutos.length) return null;
  if (!estaAberto(cfg, agora)) return null; // fora do horário o assistente já avisou quando abre
  const esperaMin = (agora.getTime() - new Date(aguardandoDesde).getTime()) / 60_000;
  return esperaMin >= cfg.espera_minutos[avisosJaEnviados] ? avisosJaEnviados : null;
}

export const MENSAGENS_ESPERA = [
  "Só um instante, já já uma atendente fala com você.",
  "Desculpe a demora! Nossas atendentes estão finalizando outros pedidos e já vão te responder.",
];
