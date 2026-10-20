"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ClienteResumo, GrupoResumo, MensagemPainel } from "@/lib/atendimento/painel";
import { Conversa } from "./conversa";
import { GrupoConversa } from "./grupo";
import { tempoDesde, useAgora, ROTULO_ASSUNTO, COR_SITUACAO, situacaoDe, type Situacao } from "./util";

/** "agora" = quem está em atendimento; "todas" = visão geral, inclusive finalizadas; "grupos" = grupos do WhatsApp. */
export type Aba = "agora" | "todas" | "grupos";

interface Props {
  usuario: { id: string; nome: string; admin: boolean };
  orgId: string | null;
  clientes: ClienteResumo[];
  conversa: { cliente: ClienteResumo; mensagens: MensagemPainel[] } | null;
  grupos: GrupoResumo[];
  grupoAberto: { grupo: GrupoResumo; mensagens: MensagemPainel[] } | null;
  /** Números da loja desconectados (aviso vermelho para toda a equipe). */
  numerosCaidos: string[];
  atendentes: { id: string; nome: string }[];
  respostasRapidas: string[];
  busca: string | null;
  aba: Aba;
  limite: number;
  temMais: boolean;
  paginaTodas: number;
}

/** Atualiza a tela sozinha quando chega mensagem ou muda o estado de um cliente. */
function useAtualizacaoAoVivo(orgId: string | null) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const atualizar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const supabase = createClient();
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelado) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      const filtro = orgId ? { filter: `organization_id=eq.${orgId}` } : {};
      canal = supabase
        .channel("painel-atendimento")
        .on("postgres_changes", { event: "*", schema: "public", table: "mensagens", ...filtro }, atualizar)
        .on("postgres_changes", { event: "*", schema: "public", table: "leads", ...filtro }, atualizar)
        .on("postgres_changes", { event: "*", schema: "public", table: "grupo_mensagens", ...filtro }, atualizar)
        .subscribe();
    })();
    // Garantia: mesmo se o tempo real cair, a tela se atualiza a cada 15 segundos.
    const intervalo = setInterval(() => router.refresh(), 15000);
    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
      clearInterval(intervalo);
      if (canal) supabase.removeChannel(canal);
    };
  }, [orgId, router]);
}

/** Toca um aviso curto quando um cliente novo entra na fila de espera. */
function useAvisoDeClienteNovo(idsEsperando: string[] | null) {
  const vistos = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!idsEsperando) return;
    const atual = new Set(idsEsperando);
    if (vistos.current) {
      const novos = idsEsperando.filter((id) => !vistos.current!.has(id));
      if (novos.length) tocarAviso();
    }
    vistos.current = atual;
    document.title = idsEsperando.length ? `(${idsEsperando.length}) Esperando - Atendimento` : "Atendimento";
  }, [idsEsperando]);
}

/**
 * Grupos com mensagem nova: guarda neste navegador quando cada grupo foi aberto
 * pela última vez. Grupo nunca aberto conta a partir da primeira vez que o painel
 * foi aberto aqui (para não marcar o histórico inteiro como novo).
 */
const CHAVE_GRUPOS_VISTOS = "bebamais:grupos-vistos";
type Vistos = { inicio: string; grupos: Record<string, string> };

const ouvintesVistos = new Set<() => void>();

/** Texto guardado (a "foto" que o React compara); vazio no servidor ou sem armazenamento. */
function fotoVistos(): string {
  try {
    return localStorage.getItem(CHAVE_GRUPOS_VISTOS) ?? "";
  } catch {
    return "";
  }
}

function assinarVistos(avisar: () => void) {
  ouvintesVistos.add(avisar);
  window.addEventListener("storage", avisar); // outra aba marcou um grupo como lido
  return () => {
    ouvintesVistos.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

function lerVistos(foto: string): Vistos | null {
  try {
    const salvo = JSON.parse(foto || "null");
    if (salvo && typeof salvo.inicio === "string" && salvo.grupos && typeof salvo.grupos === "object") return salvo;
  } catch {
    /* guardado estragado: começa do zero */
  }
  return null;
}

/** Marca o grupo como lido agora (ou só começa a contagem, se nunca foi aberto nada aqui). */
function marcarVisto(grupoId: string | null) {
  const atual = lerVistos(fotoVistos()) ?? { inicio: new Date().toISOString(), grupos: {} };
  if (grupoId) atual.grupos[grupoId] = new Date().toISOString();
  try {
    localStorage.setItem(CHAVE_GRUPOS_VISTOS, JSON.stringify(atual));
  } catch {
    return; // navegador sem armazenamento: fica sem a bolinha de "novo"
  }
  ouvintesVistos.forEach((avisar) => avisar());
}

function useGruposNovos(grupos: GrupoResumo[], abertoId: string | null): Set<string> {
  const foto = useSyncExternalStore(assinarVistos, fotoVistos, () => "");
  const vistos = useMemo(() => lerVistos(foto), [foto]);
  // Grupo aberto = lido até agora (inclusive o que chegar enquanto ele está aberto).
  const ultimaDoAberto = grupos.find((g) => g.id === abertoId)?.ultimaMensagemEm ?? null;
  useEffect(() => {
    marcarVisto(abertoId);
  }, [abertoId, ultimaDoAberto]);
  return useMemo(() => {
    const novos = new Set<string>();
    if (!vistos) return novos;
    for (const g of grupos) {
      if (g.id === abertoId || g.ultimaDaLoja || !g.ultimaMensagemEm) continue;
      const desde = vistos.grupos[g.id] ?? vistos.inicio;
      if (g.ultimaMensagemEm > desde) novos.add(g.id);
    }
    return novos;
  }, [grupos, vistos, abertoId]);
}

function tocarAviso() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.22].forEach((inicio, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = i === 0 ? 880 : 1175;
      vol.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
      vol.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + inicio + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.2);
      osc.connect(vol).connect(ctx.destination);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + 0.22);
    });
  } catch {
    /* navegador sem som liberado */
  }
}

export function Painel(props: Props) {
  const { usuario, clientes, conversa, busca, aba } = props;
  useAtualizacaoAoVivo(props.orgId);
  const agora = useAgora(20000);

  const grupos = useMemo(() => {
    const esperando = clientes
      .filter((c) => c.status === "aguardando")
      .sort((a, b) => (a.aguardandoDesde ?? "").localeCompare(b.aguardandoDesde ?? ""));
    const meus = clientes.filter((c) => c.status === "atendendo" && c.atribuidoA === usuario.id);
    const assistente = clientes.filter((c) => c.status === "bot");
    const outras = clientes.filter((c) => c.status === "atendendo" && c.atribuidoA !== usuario.id);
    return { esperando, meus, assistente, outras };
  }, [clientes, usuario.id]);

  const idsEsperando = useMemo(() => grupos.esperando.map((c) => c.id), [grupos.esperando]);
  // Na busca a lista não é a fila: lá o aviso sonoro fica quieto.
  useAvisoDeClienteNovo(busca ? null : idsEsperando);

  const grupoAbertoId = props.grupoAberto?.grupo.id ?? null;
  const gruposNovos = useGruposNovos(props.grupos, grupoAbertoId);
  const selecionado = conversa?.cliente.id ?? grupoAbertoId;
  const endereco = (extra: { c?: string; g?: string; aba?: Aba; limite?: number }) => {
    const p = new URLSearchParams();
    if (extra.c) p.set("c", extra.c);
    if (busca) p.set("busca", busca);
    const qualAba = extra.aba ?? aba;
    if (qualAba === "todas") {
      p.set("aba", "todas");
      const l = extra.limite ?? props.limite;
      if (l > props.paginaTodas) p.set("limite", String(l));
    } else if (qualAba === "grupos") {
      p.set("aba", "grupos");
      if (extra.g) p.set("g", extra.g);
    }
    const q = p.toString();
    return q ? `/atendimento?${q}` : "/atendimento";
  };
  const link = (id: string) => endereco({ c: id });
  const item = (c: ClienteResumo, mostrarSituacao = false) => (
    <ItemCliente
      key={c.id}
      c={c}
      href={link(c.id)}
      ativo={c.id === selecionado}
      agora={agora}
      situacao={situacaoDe(c, usuario.id)}
      mostrarSituacao={mostrarSituacao}
    />
  );

  return (
    <div className="h-full flex flex-col">
      {props.numerosCaidos.length > 0 && (
        <div className="shrink-0 bg-red-600 text-white px-4 py-2.5 text-sm flex flex-wrap items-center justify-between gap-2">
          <p>
            <strong>⚠ WhatsApp desconectado: {props.numerosCaidos.join(", ")}.</strong> As mensagens{" "}
            {props.numerosCaidos.length > 1 ? "desses números" : "desse número"} não estão chegando no painel.
            {usuario.admin ? " Conecte de novo lendo o QR Code." : " Avise o administrador."}
          </p>
          {usuario.admin && (
            <Link href="/admin" className="shrink-0 rounded-lg bg-white text-red-700 px-3 py-1 font-heading font-bold">
              Conectar agora
            </Link>
          )}
        </div>
      )}
    <div className="flex-1 min-h-0 flex">
      {/* Lista de clientes */}
      <aside className={`w-full md:w-[360px] shrink-0 border-r border-cinza-claro bg-white flex flex-col ${selecionado ? "hidden md:flex" : "flex"}`}>
        <form action="/atendimento" className="p-3 border-b border-cinza-claro flex gap-2">
          <input
            name="busca"
            defaultValue={busca ?? ""}
            placeholder="Buscar cliente por nome ou telefone"
            className="flex-1 rounded-lg border border-cinza-claro px-3 py-2 text-sm focus:outline-none focus:border-vermelho"
          />
          <button className="rounded-lg bg-preto text-white text-sm px-3 font-heading font-semibold">Buscar</button>
        </form>
        {busca ? (
          <Link href="/atendimento" className="px-4 py-2 text-sm text-vermelho font-semibold border-b border-cinza-claro">
            ← Voltar para os atendimentos de agora
          </Link>
        ) : (
          <nav className="flex border-b border-cinza-claro text-sm font-heading font-semibold">
            <AbaLink href={endereco({ aba: "agora" })} ativa={aba === "agora"}>
              Agora{grupos.esperando.length > 0 && aba !== "todas" ? ` (${grupos.esperando.length})` : ""}
            </AbaLink>
            <AbaLink href={endereco({ aba: "todas", limite: props.paginaTodas })} ativa={aba === "todas"}>
              Todas as conversas
            </AbaLink>
            <AbaLink href={endereco({ aba: "grupos" })} ativa={aba === "grupos"}>
              Grupos{gruposNovos.size > 0 ? ` (${gruposNovos.size})` : ""}
            </AbaLink>
          </nav>
        )}

        <div className="flex-1 overflow-y-auto">
          {busca ? (
            <Grupo titulo="Resultado da busca" vazio="Nenhum cliente encontrado.">
              {clientes.map((c) => item(c, true))}
            </Grupo>
          ) : aba === "grupos" ? (
            <>
              <p className="px-4 py-2 text-xs text-cinza-medio border-b border-cinza-claro">
                Grupos do WhatsApp da loja. O assistente não responde em grupos. Qualquer pessoa da equipe pode ler e responder.
              </p>
              {props.grupos.length === 0 && (
                <p className="px-4 py-3 text-sm text-cinza-medio">
                  Nenhum grupo ainda. Quando alguém mandar mensagem num grupo de que o WhatsApp da loja participa, ele aparece aqui.
                </p>
              )}
              {props.grupos.map((g) => (
                <ItemGrupo
                  key={g.id}
                  g={g}
                  href={endereco({ aba: "grupos", g: g.id })}
                  ativo={g.id === grupoAbertoId}
                  novo={gruposNovos.has(g.id)}
                  agora={agora}
                />
              ))}
            </>
          ) : aba === "todas" ? (
            <>
              <p className="px-4 py-2 text-xs text-cinza-medio border-b border-cinza-claro">
                Todas as conversas desde que o número foi conectado, da mais recente para a mais antiga. Clique numa finalizada para retomar.
              </p>
              {clientes.length === 0 && <p className="px-4 py-3 text-sm text-cinza-medio">Nenhuma conversa ainda.</p>}
              {clientes.map((c) => item(c, true))}
              {props.temMais && (
                <Link
                  href={endereco({ aba: "todas", limite: props.limite + props.paginaTodas })}
                  scroll={false}
                  className="block px-4 py-3 text-center text-sm font-semibold text-vermelho border-t border-cinza-claro hover:bg-offwhite"
                >
                  Carregar mais conversas
                </Link>
              )}
            </>
          ) : (
            <>
              <Grupo
                titulo="Esperando atendente"
                situacao="esperando"
                destaque={grupos.esperando.length > 0}
                contagem={grupos.esperando.length}
                vazio="Ninguém esperando agora."
              >
                {grupos.esperando.map((c) => item(c))}
              </Grupo>
              <Grupo titulo="Minhas conversas" situacao="minha" contagem={grupos.meus.length} vazio="Você não está atendendo ninguém.">
                {grupos.meus.map((c) => item(c))}
              </Grupo>
              {grupos.assistente.length > 0 && (
                <Grupo titulo="Com o assistente agora" situacao="assistente" contagem={grupos.assistente.length}>
                  {grupos.assistente.map((c) => item(c))}
                </Grupo>
              )}
              {grupos.outras.length > 0 && (
                <Grupo titulo="Com outras atendentes" situacao="outra" contagem={grupos.outras.length}>
                  {grupos.outras.map((c) => item(c))}
                </Grupo>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Conversa aberta */}
      <section className={`flex-1 min-w-0 ${selecionado ? "flex" : "hidden md:flex"} flex-col`}>
        {props.grupoAberto ? (
          <GrupoConversa
            key={props.grupoAberto.grupo.id}
            grupo={props.grupoAberto.grupo}
            mensagens={props.grupoAberto.mensagens}
            voltarHref={endereco({})}
          />
        ) : conversa ? (
          <Conversa
            key={conversa.cliente.id}
            usuario={usuario}
            cliente={conversa.cliente}
            mensagens={conversa.mensagens}
            atendentes={props.atendentes}
            respostasRapidas={props.respostasRapidas}
            voltarHref={endereco({})}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            {aba === "grupos" ? (
              <div className="max-w-sm text-center">
                <p className="text-xl font-heading font-semibold text-preto mb-2">Escolha um grupo na lista</p>
                <p className="text-cinza-medio">
                  Os grupos com <span className="font-semibold text-amber-700">mensagem nova</span> aparecem com uma bolinha amarela.
                  Clique para ler e responder.
                </p>
              </div>
            ) : (
            <div className="max-w-sm text-center">
              <p className="text-xl font-heading font-semibold text-preto mb-2">Escolha um cliente na lista</p>
              <p className="text-cinza-medio">
                Os clientes em <span className="text-vermelho font-semibold">vermelho</span> estão esperando. Clique em um e depois em
                <span className="font-semibold"> “Pegar este cliente”</span>.
              </p>
              <ul className="mt-4 flex flex-wrap justify-center gap-1.5">
                {(Object.keys(COR_SITUACAO) as Situacao[]).map((s) => (
                  <li key={s} className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${COR_SITUACAO[s].chip}`}>
                    {COR_SITUACAO[s].rotulo}
                  </li>
                ))}
              </ul>
            </div>
            )}
          </div>
        )}
      </section>
    </div>
    </div>
  );
}

function ItemGrupo(props: { g: GrupoResumo; href: string; ativo: boolean; novo: boolean; agora: number }) {
  const { g } = props;
  return (
    <Link
      href={props.href}
      className={`block pl-3 pr-4 py-3 border-l-4 border-t border-t-cinza-claro/60 first:border-t-0 transition ${
        props.novo ? "border-l-amber-500" : "border-l-transparent"
      } ${props.ativo ? "bg-dourado/15" : props.novo ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-offwhite"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading font-semibold text-preto truncate">
          <span aria-hidden>👥 </span>
          {g.nome}
        </span>
        <span className="shrink-0 flex items-center gap-1.5">
          {props.novo && <span className="h-2.5 w-2.5 rounded-full bg-amber-500" title="Mensagem nova" />}
          {g.ultimaMensagemEm && <span className="text-xs text-cinza-medio">{tempoDesde(g.ultimaMensagemEm, props.agora)}</span>}
        </span>
      </div>
      {g.numeroApelido && (
        <span className="mt-1 inline-block text-[11px] font-semibold rounded border border-cinza-claro text-cinza-medio px-1.5 py-0.5">
          {g.numeroApelido}
        </span>
      )}
      {g.ultimaMensagem && (
        <p className={`mt-1 text-sm truncate ${props.novo ? "text-preto font-semibold" : "text-cinza-medio"}`}>{g.ultimaMensagem}</p>
      )}
    </Link>
  );
}

function AbaLink(props: { href: string; ativa: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={`flex-auto whitespace-nowrap px-2 py-2.5 text-center border-b-2 transition ${
        props.ativa ? "border-vermelho text-preto" : "border-transparent text-cinza-medio hover:text-preto hover:bg-offwhite"
      }`}
    >
      {props.children}
    </Link>
  );
}

function Grupo(props: {
  titulo: string;
  situacao?: Situacao;
  contagem?: number;
  destaque?: boolean;
  vazio?: string;
  children: React.ReactNode;
}) {
  const temItens = Array.isArray(props.children) ? props.children.length > 0 : !!props.children;
  const cor = props.destaque ? "bg-vermelho text-white" : props.situacao ? COR_SITUACAO[props.situacao].cabecalho : "bg-offwhite text-preto";
  return (
    <div className="border-b border-cinza-claro">
      <div className={`px-4 py-2 flex items-center justify-between text-xs font-heading font-bold uppercase tracking-wide ${cor}`}>
        <span>{props.titulo}</span>
        {typeof props.contagem === "number" && <span>{props.contagem}</span>}
      </div>
      {temItens ? props.children : props.vazio ? <p className="px-4 py-3 text-sm text-cinza-medio">{props.vazio}</p> : null}
    </div>
  );
}

/** Rótulo da situação no chip (na aba "Todas" e na busca): diz com quem está. */
function rotuloSituacao(c: ClienteResumo, s: Situacao): string {
  if (s === "outra") {
    if (!c.atribuidoA && c.atribuidoNome === "Pelo celular") return "Pelo celular";
    if (c.atribuidoNome) return `Com ${c.atribuidoNome}`;
  }
  return COR_SITUACAO[s].rotulo;
}

function ItemCliente(props: {
  c: ClienteResumo;
  href: string;
  ativo: boolean;
  agora: number;
  situacao: Situacao;
  mostrarSituacao: boolean;
}) {
  const { c, href, ativo, agora, situacao } = props;
  const esperando = c.status === "aguardando";
  return (
    <Link
      href={href}
      className={`block pl-3 pr-4 py-3 border-l-4 rounded-none border-t border-t-cinza-claro/60 first:border-t-0 transition ${
        COR_SITUACAO[situacao].barra
      } ${ativo ? "bg-dourado/15" : esperando ? "bg-red-50 hover:bg-red-100" : "hover:bg-offwhite"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading font-semibold text-preto truncate">{c.nome}</span>
        {esperando && c.aguardandoDesde ? (
          <span className="shrink-0 text-xs font-bold text-white bg-vermelho rounded-full px-2 py-0.5">
            {tempoDesde(c.aguardandoDesde, agora)}
          </span>
        ) : c.ultimaMensagemEm ? (
          <span className="shrink-0 text-xs text-cinza-medio">{tempoDesde(c.ultimaMensagemEm, agora)}</span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        {props.mostrarSituacao && (
          <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${COR_SITUACAO[situacao].chip}`}>{rotuloSituacao(c, situacao)}</span>
        )}
        {c.assunto && (
          <span className="text-[11px] font-semibold rounded bg-preto/80 text-white px-1.5 py-0.5">{ROTULO_ASSUNTO[c.assunto]}</span>
        )}
        {c.numeroApelido && (
          <span className="text-[11px] font-semibold rounded border border-cinza-claro text-cinza-medio px-1.5 py-0.5">
            {c.numeroApelido}
          </span>
        )}
        {!props.mostrarSituacao && c.status === "atendendo" && c.atribuidoNome && (
          <span className="text-[11px] text-cinza-medio">
            {!c.atribuidoA && c.atribuidoNome === "Pelo celular" ? "pelo celular" : `com ${c.atribuidoNome}`}
          </span>
        )}
      </div>
      {c.ultimaMensagem && (
        <p className={`mt-1 text-sm truncate ${c.ultimaDoCliente ? "text-preto" : "text-cinza-medio"}`}>{c.ultimaMensagem}</p>
      )}
    </Link>
  );
}
