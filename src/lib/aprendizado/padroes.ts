/**
 * Padrões do atendimento real, calculados das conversas captadas no Aprendizado.
 * Serve para ajustar as informações da loja e o jeito de o assistente falar:
 * quando a loja tem mais movimento, quanto a equipe demora para responder, as
 * frases que a equipe mais usa (o "jeito" dela) e como os clientes começam.
 *
 * Função pura (sem banco), para dar para testar.
 */

export interface MensagemCaptada {
  conversa_jid: string;
  direcao: "cliente" | "equipe";
  tipo: string;
  conteudo: string | null;
  enviada_em: string;
}

export interface FraseContada {
  exemplo: string;
  vezes: number;
}

export interface Padroes {
  mensagens: number;
  conversas: number;
  /** Mensagens de clientes por hora do dia (0 a 23), no horário de São Paulo. */
  porHora: number[];
  /** Mensagens de clientes por dia da semana (0 = domingo). */
  porDia: number[];
  /** Tempo (minutos) até a equipe responder quando o cliente chama: mediana e quantos em até 5 min. */
  respostaMedianaMin: number | null;
  respondidasAte5Min: number;
  respostasMedidas: number;
  /** Frases que a equipe mais repete (o "jeito" dela falar). */
  frasesEquipe: FraseContada[];
  /** Como os clientes começam a conversa. */
  aberturasClientes: FraseContada[];
}

/** Depois de tanto tempo parado, a próxima mensagem do cliente é um atendimento novo. */
const NOVO_ATENDIMENTO_MS = 6 * 60 * 60 * 1000;
/** Resposta da equipe depois disso não conta como "tempo de resposta" (foi no outro dia). */
const RESPOSTA_MAX_MS = 12 * 60 * 60 * 1000;

const fmtHora = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" });
const fmtDia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" });
const DIAS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Bom dia!!  Tudo bem?" → "bom dia tudo bem" (para contar frases iguais escritas de jeitos diferentes). */
export function normalizarFrase(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contar(textos: string[], limite: number, minimoVezes: number): FraseContada[] {
  const mapa = new Map<string, FraseContada>();
  for (const t of textos) {
    const chave = normalizarFrase(t);
    if (chave.length < 2 || chave.length > 140) continue;
    const atual = mapa.get(chave);
    if (atual) atual.vezes++;
    else mapa.set(chave, { exemplo: t.trim().replace(/\s+/g, " ").slice(0, 140), vezes: 1 });
  }
  return [...mapa.values()]
    .filter((f) => f.vezes >= minimoVezes)
    .sort((a, b) => b.vezes - a.vezes)
    .slice(0, limite);
}

export function calcularPadroes(msgs: MensagemCaptada[]): Padroes {
  const porHora = new Array(24).fill(0);
  const porDia = new Array(7).fill(0);
  const frasesEquipe: string[] = [];
  const aberturas: string[] = [];
  const tempos: number[] = [];

  const porConversa = new Map<string, MensagemCaptada[]>();
  for (const m of msgs) {
    const lista = porConversa.get(m.conversa_jid);
    if (lista) lista.push(m);
    else porConversa.set(m.conversa_jid, [m]);
  }

  for (const lista of porConversa.values()) {
    lista.sort((a, b) => a.enviada_em.localeCompare(b.enviada_em));
    let anterior: MensagemCaptada | null = null;
    // Cliente que chamou e ainda não teve resposta da equipe (início da espera).
    let esperandoDesde: number | null = null;
    for (const m of lista) {
      const t = new Date(m.enviada_em).getTime();
      const texto = m.tipo === "texto" ? m.conteudo?.trim() ?? "" : "";
      if (m.direcao === "cliente") {
        porHora[Number(fmtHora.format(t)) % 24]++;
        porDia[Math.max(0, DIAS_EN.indexOf(fmtDia.format(t)))]++;
        const novoAtendimento = !anterior || t - new Date(anterior.enviada_em).getTime() > NOVO_ATENDIMENTO_MS;
        if (novoAtendimento && texto) aberturas.push(texto);
        if (esperandoDesde === null) esperandoDesde = t;
      } else {
        if (texto) frasesEquipe.push(texto);
        if (esperandoDesde !== null) {
          const espera = t - esperandoDesde;
          if (espera >= 0 && espera <= RESPOSTA_MAX_MS) tempos.push(espera);
          esperandoDesde = null;
        }
      }
      anterior = m;
    }
  }

  tempos.sort((a, b) => a - b);
  const mediana = tempos.length ? tempos[Math.floor((tempos.length - 1) / 2)] : null;
  return {
    mensagens: msgs.length,
    conversas: porConversa.size,
    porHora,
    porDia,
    respostaMedianaMin: mediana === null ? null : Math.round(mediana / 60000),
    respondidasAte5Min: tempos.filter((ms) => ms <= 5 * 60000).length,
    respostasMedidas: tempos.length,
    frasesEquipe: contar(frasesEquipe, 12, 2),
    aberturasClientes: contar(aberturas, 10, 2),
  };
}
