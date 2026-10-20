/**
 * Dados do painel de atendimento (lado do servidor).
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { linksAssinados } from "./arquivos";
import type { AtendStatus, Assunto } from "./regras";

export interface UsuarioPainel {
  id: string;
  nome: string;
  role: "admin" | "client";
  orgId: string | null;
}

export async function usuarioAtual(): Promise<UsuarioPainel | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase
    .from("profiles")
    .select("nome, role, organization_id")
    .eq("id", user.id)
    .maybeSingle();
  return {
    id: user.id,
    nome: p?.nome?.trim() || "Atendente",
    role: p?.role === "admin" ? "admin" : "client",
    orgId: p?.organization_id ?? process.env.DEFAULT_ORG_ID ?? null,
  };
}

export interface ClienteResumo {
  id: string;
  nome: string;
  telefone: string;
  status: AtendStatus;
  assunto: Assunto | null;
  numeroApelido: string | null;
  atribuidoA: string | null;
  atribuidoNome: string | null;
  aguardandoDesde: string | null;
  ultimaMensagem: string | null;
  ultimaMensagemEm: string | null;
  ultimaDoCliente: boolean;
}

export interface MensagemPainel {
  id: string;
  doCliente: boolean;
  autor: string;
  remetente: string;
  tipo: string;
  texto: string | null;
  arquivoUrl: string | null;
  arquivoNome: string | null;
  falhou: boolean;
  em: string;
}

export function formatarTelefone(digitos: string): string {
  const d = digitos.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d ? `+${d}` : "";
}

function previa(m: { tipo: string; conteudo: string | null }): string {
  const t = (m.conteudo ?? "").replace(/\s+/g, " ").trim();
  if (m.tipo === "imagem") return `📷 Foto${t ? `: ${t}` : ""}`;
  if (m.tipo === "arquivo") return `📎 Arquivo${t ? `: ${t}` : ""}`;
  if (m.tipo === "audio") return `🎤 Áudio${t ? `: ${t}` : ""}`;
  if (m.tipo === "video") return "🎬 Vídeo";
  if (m.tipo === "localizacao") return "📍 Localização";
  return t;
}

async function apelidosDosNumeros(): Promise<Record<string, string>> {
  const { data } = await createAdminClient().from("org_numeros").select("instance_name, apelido, numero");
  const out: Record<string, string> = {};
  for (const n of data ?? []) {
    out[n.instance_name] = n.apelido?.trim() || (n.numero ? formatarTelefone(n.numero) : n.instance_name);
  }
  return out;
}

interface LeadLinha {
  id: string;
  nome: string | null;
  telefone: string | null;
  telefone_digitos: string | null;
  atend_status: string;
  assunto: string | null;
  evolution_instance: string | null;
  atribuido_a: string | null;
  atribuido_nome: string | null;
  aguardando_desde: string | null;
  ultima_msg_lead_em: string | null;
  updated_at: string | null;
}

const CAMPOS_LISTA =
  "id, nome, telefone, telefone_digitos, atend_status, assunto, evolution_instance, atribuido_a, atribuido_nome, aguardando_desde, ultima_msg_lead_em, updated_at";

/** Clientes que aparecem na lista: em atendimento agora, ou que bateram com a busca. */
export async function listarClientes(busca: string | null): Promise<ClienteResumo[]> {
  const supabase = await createClient();
  const termo = busca?.trim();
  let leads: LeadLinha[] = [];
  if (termo) {
    const digitos = termo.replace(/\D/g, "");
    const seguro = termo.replace(/[%,()*]/g, " ");
    let q = supabase.from("leads").select(CAMPOS_LISTA).order("updated_at", { ascending: false }).limit(80);
    q = digitos.length >= 4
      ? q.or(`telefone_digitos.ilike.%${digitos}%,nome.ilike.%${seguro}%`)
      : q.ilike("nome", `%${seguro}%`);
    leads = ((await q).data ?? []) as LeadLinha[];
  } else {
    // Quem está esperando aparece SEMPRE (sem limite pequeno), mais as conversas em andamento.
    const [esperando, andamento] = await Promise.all([
      supabase.from("leads").select(CAMPOS_LISTA).eq("atend_status", "aguardando").order("aguardando_desde", { ascending: true }).limit(500),
      supabase.from("leads").select(CAMPOS_LISTA).in("atend_status", ["bot", "atendendo"]).order("updated_at", { ascending: false }).limit(120),
    ]);
    leads = [...(esperando.data ?? []), ...(andamento.data ?? [])] as LeadLinha[];
  }
  return resumir(supabase, leads);
}

/**
 * Visão geral (aba "Todas"): todas as conversas, inclusive as finalizadas, da
 * mais recente para a mais antiga. Busca uma a mais para saber se há outra página.
 */
export async function listarTodas(limite: number): Promise<{ clientes: ClienteResumo[]; temMais: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select(CAMPOS_LISTA)
    .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limite + 1);
  const leads = (data ?? []) as LeadLinha[];
  return { clientes: await resumir(supabase, leads.slice(0, limite)), temMais: leads.length > limite };
}

async function resumir(supabase: Awaited<ReturnType<typeof createClient>>, leads: LeadLinha[]): Promise<ClienteResumo[]> {
  if (!leads.length) return [];

  const ids = leads.map((l) => l.id);
  const [{ data: msgs }, apelidos] = await Promise.all([
    supabase
      .from("mensagens")
      .select("lead_id, tipo, conteudo, direcao, created_at")
      .in("lead_id", ids)
      .eq("shadow", false)
      .order("created_at", { ascending: false })
      .limit(400),
    apelidosDosNumeros(),
  ]);
  const ultima = new Map<string, { tipo: string; conteudo: string | null; direcao: string; created_at: string }>();
  for (const m of msgs ?? []) if (!ultima.has(m.lead_id)) ultima.set(m.lead_id, m);

  return leads.map((l) => {
    const u = ultima.get(l.id);
    return {
      id: l.id,
      nome: l.nome?.trim() || formatarTelefone(l.telefone_digitos ?? l.telefone ?? ""),
      telefone: formatarTelefone(l.telefone_digitos ?? l.telefone ?? ""),
      status: l.atend_status as AtendStatus,
      assunto: (l.assunto as Assunto | null) ?? null,
      numeroApelido: l.evolution_instance ? apelidos[l.evolution_instance] ?? null : null,
      atribuidoA: l.atribuido_a,
      atribuidoNome: l.atribuido_nome,
      aguardandoDesde: l.aguardando_desde,
      ultimaMensagem: u ? previa(u) : null,
      ultimaMensagemEm: u?.created_at ?? l.updated_at,
      ultimaDoCliente: u?.direcao === "entrada",
    };
  });
}

export async function carregarConversa(leadId: string): Promise<{ cliente: ClienteResumo; mensagens: MensagemPainel[] } | null> {
  const supabase = await createClient();
  const { data: l } = await supabase
    .from("leads")
    .select("id, nome, telefone, telefone_digitos, atend_status, assunto, evolution_instance, atribuido_a, atribuido_nome, aguardando_desde, updated_at")
    .eq("id", leadId)
    .maybeSingle();
  if (!l) return null;
  const { data: msgs } = await supabase
    .from("mensagens")
    .select("id, direcao, autor, remetente_nome, tipo, conteudo, arquivo_path, arquivo_nome, attachment_url, falha_envio, created_at")
    .eq("lead_id", leadId)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(150);
  const lista = (msgs ?? []).reverse();
  const [links, apelidos] = await Promise.all([
    linksAssinados(lista.map((m) => m.arquivo_path).filter(Boolean) as string[]),
    apelidosDosNumeros(),
  ]);
  const nome = l.nome?.trim() || formatarTelefone(l.telefone_digitos ?? l.telefone ?? "");
  const ult = lista[lista.length - 1];
  return {
    cliente: {
      id: l.id,
      nome,
      telefone: formatarTelefone(l.telefone_digitos ?? l.telefone ?? ""),
      status: l.atend_status as AtendStatus,
      assunto: (l.assunto as Assunto | null) ?? null,
      numeroApelido: l.evolution_instance ? apelidos[l.evolution_instance] ?? null : null,
      atribuidoA: l.atribuido_a,
      atribuidoNome: l.atribuido_nome,
      aguardandoDesde: l.aguardando_desde,
      ultimaMensagem: null,
      ultimaMensagemEm: ult?.created_at ?? l.updated_at,
      ultimaDoCliente: ult?.direcao === "entrada",
    },
    mensagens: lista.map((m) => {
      const doCliente = m.direcao === "entrada";
      const autor = m.autor ?? (doCliente ? "cliente" : "atendente");
      return {
        id: m.id,
        doCliente,
        autor,
        remetente: doCliente
          ? nome
          : autor === "assistente"
            ? "Assistente"
            : autor === "celular"
              ? "Pelo celular"
              : m.remetente_nome?.trim() || "Loja",
        tipo: m.tipo ?? "texto",
        texto: m.conteudo,
        arquivoUrl: (m.arquivo_path ? links[m.arquivo_path] : null) ?? m.attachment_url ?? null,
        arquivoNome: m.arquivo_nome,
        falhou: m.falha_envio === true,
        em: m.created_at,
      };
    }),
  };
}

export interface GrupoResumo {
  id: string;
  nome: string;
  numeroApelido: string | null;
  ultimaMensagem: string | null;
  ultimaMensagemEm: string | null;
  /** A última mensagem foi da própria loja (painel ou celular)? Então não há nada novo para ler. */
  ultimaDaLoja: boolean;
}

/** Grupos do WhatsApp (aba "Grupos"), do mais movimentado agora para o mais parado. */
export async function listarGrupos(): Promise<GrupoResumo[]> {
  const supabase = await createClient();
  const { data: grupos } = await supabase
    .from("grupos")
    .select("id, nome, instance_name, ultima_atividade_em, created_at")
    .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
    .limit(100);
  if (!grupos?.length) return [];
  const [{ data: msgs }, apelidos] = await Promise.all([
    supabase
      .from("grupo_mensagens")
      .select("grupo_id, tipo, conteudo, direcao, remetente_nome, created_at")
      .in("grupo_id", grupos.map((g) => g.id))
      .order("created_at", { ascending: false })
      .limit(400),
    apelidosDosNumeros(),
  ]);
  const ultima = new Map<string, { tipo: string; conteudo: string | null; direcao: string; remetente_nome: string | null; created_at: string }>();
  for (const m of msgs ?? []) if (!ultima.has(m.grupo_id)) ultima.set(m.grupo_id, m);
  return grupos.map((g) => {
    const u = ultima.get(g.id);
    const quem = u?.direcao === "saida" ? "Você" : u?.remetente_nome?.trim();
    return {
      id: g.id,
      nome: g.nome?.trim() || "Grupo sem nome",
      numeroApelido: apelidos[g.instance_name] ?? null,
      ultimaMensagem: u ? `${quem ? `${quem}: ` : ""}${previa(u)}` : null,
      ultimaMensagemEm: u?.created_at ?? g.ultima_atividade_em ?? g.created_at,
      ultimaDaLoja: u?.direcao === "saida",
    };
  });
}

export async function carregarGrupo(grupoId: string): Promise<{ grupo: GrupoResumo; mensagens: MensagemPainel[] } | null> {
  const supabase = await createClient();
  const { data: g } = await supabase
    .from("grupos")
    .select("id, nome, instance_name, ultima_atividade_em, created_at")
    .eq("id", grupoId)
    .maybeSingle();
  if (!g) return null;
  const { data: msgs } = await supabase
    .from("grupo_mensagens")
    .select("id, direcao, autor, remetente_nome, remetente_numero, tipo, conteudo, arquivo_path, arquivo_nome, falha_envio, created_at")
    .eq("grupo_id", grupoId)
    .order("created_at", { ascending: false })
    .limit(200);
  const lista = (msgs ?? []).reverse();
  const [links, apelidos] = await Promise.all([
    linksAssinados(lista.map((m) => m.arquivo_path).filter(Boolean) as string[]),
    apelidosDosNumeros(),
  ]);
  const ult = lista[lista.length - 1];
  return {
    grupo: {
      id: g.id,
      nome: g.nome?.trim() || "Grupo sem nome",
      numeroApelido: apelidos[g.instance_name] ?? null,
      ultimaMensagem: null,
      ultimaMensagemEm: ult?.created_at ?? g.ultima_atividade_em ?? g.created_at,
      ultimaDaLoja: ult?.direcao === "saida",
    },
    mensagens: lista.map((m) => {
      const deMembro = m.direcao === "entrada";
      return {
        id: m.id,
        doCliente: deMembro,
        autor: m.autor,
        remetente: deMembro
          ? m.remetente_nome?.trim() || (m.remetente_numero ? formatarTelefone(m.remetente_numero) : "Alguém do grupo")
          : m.autor === "celular"
            ? "Pelo celular"
            : m.remetente_nome?.trim() || "Loja",
        tipo: m.tipo ?? "texto",
        texto: m.conteudo,
        arquivoUrl: m.arquivo_path ? links[m.arquivo_path] ?? null : null,
        arquivoNome: m.arquivo_nome,
        falhou: m.falha_envio === true,
        em: m.created_at,
      };
    }),
  };
}

/** Números da loja que caíram (desconectados): aparecem num aviso vermelho para toda a equipe. */
export async function numerosDesconectados(): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("org_numeros")
    .select("apelido, numero, status_conexao, ativo")
    .eq("ativo", true)
    .eq("status_conexao", "close");
  return (data ?? []).map((n) => n.apelido?.trim() || (n.numero ? formatarTelefone(n.numero) : "da loja"));
}

export async function listarAtendentes(orgId: string | null): Promise<{ id: string; nome: string }[]> {
  if (!orgId) return [];
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id, nome")
    .eq("organization_id", orgId)
    .order("nome");
  return (data ?? []).map((p) => ({ id: p.id, nome: p.nome?.trim() || "Sem nome" }));
}

export async function respostasRapidas(orgId: string | null): Promise<string[]> {
  if (!orgId) return [];
  const { data } = await createAdminClient().from("organizations").select("respostas_rapidas").eq("id", orgId).maybeSingle();
  const lista = Array.isArray(data?.respostas_rapidas) ? data.respostas_rapidas : [];
  return lista.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 12);
}
