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
  /** Onde a loja fica (ex.: "Americana/SP"). O assistente sempre pode dizer isso. */
  cidade: string;
  /** Datas em que a loja não abre (feriados), no formato "2026-10-12", horário de São Paulo. */
  dias_fechados: string[];
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
  cidade: "Americana/SP",
  dias_fechados: [],
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
    cidade: typeof r.cidade === "string" && r.cidade.trim() ? r.cidade.trim().slice(0, 80) : CONFIG_PADRAO.cidade,
    dias_fechados: Array.isArray(r.dias_fechados)
      ? [...new Set(r.dias_fechados.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-60)
      : [],
  };
}

export function horaValida(h: unknown): h is string {
  return typeof h === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
}

function minutos(h: string): number {
  const [hh, mm] = h.split(":").map(Number);
  return hh * 60 + mm;
}

/** Dia da semana, data e minuto do dia no horário de São Paulo. */
export function agoraSaoPaulo(agora: Date): { dia: DiaSemana; minuto: number; hhmm: string; data: string } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const wd = partes.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hh = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(partes.find((p) => p.type === "minute")?.value ?? "0");
  const mapa: Record<string, DiaSemana> = { Sun: "dom", Mon: "seg", Tue: "ter", Wed: "qua", Thu: "qui", Fri: "sex", Sat: "sab" };
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return {
    dia: mapa[wd] ?? "seg",
    minuto: hh * 60 + mm,
    hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    data: `${v("year")}-${v("month")}-${v("day")}`,
  };
}

/** "2026-10-12" → "12/10". */
export function dataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function estaAberto(cfg: AtendimentoConfig, agora: Date): boolean {
  const { dia, minuto, data } = agoraSaoPaulo(agora);
  const h = cfg.horarios[dia];
  if (!h || cfg.dias_fechados.includes(data)) return false;
  return minuto >= minutos(h.abre) && minuto < minutos(h.fecha);
}

/** "hoje às 08:00", "amanhã (sábado) às 08:00", "segunda-feira às 08:00". */
export function proximaAbertura(cfg: AtendimentoConfig, agora: Date): string | null {
  const { minuto } = agoraSaoPaulo(agora);
  for (let i = 0; i < 40; i++) {
    const outro = agoraSaoPaulo(new Date(agora.getTime() + i * 86_400_000));
    const d = outro.dia;
    const h = cfg.horarios[d];
    if (!h || cfg.dias_fechados.includes(outro.data)) continue;
    if (i === 0 && minuto >= minutos(h.abre)) continue; // hoje já abriu (ou já passou)
    if (i === 0) return `hoje às ${h.abre}`;
    if (i === 1) return `amanhã (${NOME_DIA[d]}) às ${h.abre}`;
    if (i < 7) return `${NOME_DIA[d]} às ${h.abre}`;
    return `${NOME_DIA[d]}, ${dataCurta(outro.data)}, às ${h.abre}`;
  }
  return null;
}

/** Texto legível dos horários, para o assistente responder "que horas vocês abrem?". */
export function horariosEmTexto(cfg: AtendimentoConfig, agora: Date = new Date()): string {
  const semana = DIAS.map((d) => {
    const h = cfg.horarios[d];
    return `${NOME_DIA[d]}: ${h ? `${h.abre} às ${h.fecha}` : "fechado"}`;
  }).join("; ");
  const hoje = agoraSaoPaulo(agora).data;
  const fechados = cfg.dias_fechados.filter((d) => d >= hoje).map(dataCurta);
  return fechados.length ? `${semana}. Fechado também nos dias: ${fechados.join(", ")}` : semana;
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
 * - finalizado, ou parado há mais de `reiniciar_apos_horas` (exceto quem está na fila) → conversa nova.
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
  // Quem está na fila continua na fila (não perde o lugar nem é recumprimentado).
  const novaConversa = lead.atend_status === "finalizado" || (parado && lead.atend_status !== "aguardando");
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

/** Momento em que a loja abriu hoje (ou null se hoje está fechada). */
export function aberturaDeHoje(cfg: AtendimentoConfig, agora: Date): Date | null {
  const { dia, minuto, data } = agoraSaoPaulo(agora);
  const h = cfg.horarios[dia];
  if (!h || cfg.dias_fechados.includes(data)) return null;
  const diff = minuto - minutos(h.abre);
  const d = new Date(agora.getTime() - diff * 60_000);
  d.setSeconds(0, 0);
  return d;
}

/**
 * Qual mensagem de espera mandar agora (índice), ou null se nenhuma.
 * A espera conta a partir de quando a loja abriu (quem chegou de madrugada não
 * recebe as duas mensagens de uma vez às 8h) e respeita o intervalo entre avisos.
 */
export function avisoDeEsperaDevido(
  aguardandoDesde: string | null,
  avisosJaEnviados: number,
  ultimoAvisoEm: string | null,
  cfg: AtendimentoConfig,
  agora: Date,
): number | null {
  if (!aguardandoDesde) return null;
  const i = avisosJaEnviados;
  if (i >= cfg.espera_minutos.length) return null;
  if (!estaAberto(cfg, agora)) return null; // fora do horário o assistente já avisou quando abre
  const abertura = aberturaDeHoje(cfg, agora);
  const inicio = Math.max(new Date(aguardandoDesde).getTime(), abertura?.getTime() ?? 0);
  const esperaMin = (agora.getTime() - inicio) / 60_000;
  if (esperaMin < cfg.espera_minutos[i]) return null;
  if (i > 0 && ultimoAvisoEm) {
    const intervalo = cfg.espera_minutos[i] - cfg.espera_minutos[i - 1];
    if ((agora.getTime() - new Date(ultimoAvisoEm).getTime()) / 60_000 < intervalo) return null;
  }
  return i;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), como "AAAA-MM-DD". */
function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function somarDias(iso: string, dias: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) + dias * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Feriados nacionais (datas oficiais) de `desde` até 12 meses depois, para o
 * admin cadastrar com um clique. Carnaval e Corpus Christi são ponto facultativo:
 * ficam de fora (a loja adiciona à mão se fechar). `desde` = "AAAA-MM-DD".
 */
export function feriadosNacionais(desde: string): { data: string; nome: string }[] {
  const ano = Number(desde.slice(0, 4));
  const ate = `${ano + 1}${desde.slice(4)}`;
  const lista: { data: string; nome: string }[] = [];
  for (const a of [ano, ano + 1]) {
    lista.push(
      { data: `${a}-01-01`, nome: "Confraternização Universal" },
      { data: somarDias(pascoa(a), -2), nome: "Sexta-feira Santa" },
      { data: `${a}-04-21`, nome: "Tiradentes" },
      { data: `${a}-05-01`, nome: "Dia do Trabalho" },
      { data: `${a}-09-07`, nome: "Independência do Brasil" },
      { data: `${a}-10-12`, nome: "Nossa Senhora Aparecida" },
      { data: `${a}-11-02`, nome: "Finados" },
      { data: `${a}-11-15`, nome: "Proclamação da República" },
      { data: `${a}-11-20`, nome: "Dia da Consciência Negra" },
      { data: `${a}-12-25`, nome: "Natal" },
    );
  }
  return lista.filter((f) => f.data >= desde && f.data < ate).sort((x, y) => x.data.localeCompare(y.data));
}

export const MENSAGENS_ESPERA = [
  "Só um instante, já já uma atendente fala com você.",
  "Desculpe a demora! Nossas atendentes estão finalizando outros pedidos e já vão te responder.",
];
