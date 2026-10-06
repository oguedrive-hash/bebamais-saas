"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ClienteResumo, MensagemPainel } from "@/lib/atendimento/painel";
import { Conversa } from "./conversa";
import { tempoDesde, useAgora, ROTULO_ASSUNTO } from "./util";

interface Props {
  usuario: { id: string; nome: string; admin: boolean };
  orgId: string | null;
  clientes: ClienteResumo[];
  conversa: { cliente: ClienteResumo; mensagens: MensagemPainel[] } | null;
  atendentes: { id: string; nome: string }[];
  respostasRapidas: string[];
  busca: string | null;
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
function useAvisoDeClienteNovo(idsEsperando: string[]) {
  const vistos = useRef<Set<string> | null>(null);
  useEffect(() => {
    const atual = new Set(idsEsperando);
    if (vistos.current) {
      const novos = idsEsperando.filter((id) => !vistos.current!.has(id));
      if (novos.length) tocarAviso();
    }
    vistos.current = atual;
    document.title = idsEsperando.length ? `(${idsEsperando.length}) Esperando - Atendimento` : "Atendimento";
  }, [idsEsperando]);
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
  const { usuario, clientes, conversa, busca } = props;
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
  useAvisoDeClienteNovo(idsEsperando);

  const selecionado = conversa?.cliente.id ?? null;
  const link = (id: string) => `/atendimento?c=${id}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;

  return (
    <div className="h-full flex">
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
        {busca && (
          <Link href="/atendimento" className="px-4 py-2 text-sm text-vermelho font-semibold border-b border-cinza-claro">
            ← Voltar para os atendimentos de agora
          </Link>
        )}

        <div className="flex-1 overflow-y-auto">
          {busca ? (
            <Grupo titulo="Resultado da busca" vazio="Nenhum cliente encontrado.">
              {clientes.map((c) => (
                <ItemCliente key={c.id} c={c} href={link(c.id)} ativo={c.id === selecionado} agora={agora} />
              ))}
            </Grupo>
          ) : (
            <>
              <Grupo
                titulo="Esperando atendente"
                destaque={grupos.esperando.length > 0}
                contagem={grupos.esperando.length}
                vazio="Ninguém esperando agora."
              >
                {grupos.esperando.map((c) => (
                  <ItemCliente key={c.id} c={c} href={link(c.id)} ativo={c.id === selecionado} agora={agora} />
                ))}
              </Grupo>
              <Grupo titulo="Minhas conversas" contagem={grupos.meus.length} vazio="Você não está atendendo ninguém.">
                {grupos.meus.map((c) => (
                  <ItemCliente key={c.id} c={c} href={link(c.id)} ativo={c.id === selecionado} agora={agora} />
                ))}
              </Grupo>
              {grupos.assistente.length > 0 && (
                <Grupo titulo="Com o assistente agora" contagem={grupos.assistente.length} discreto>
                  {grupos.assistente.map((c) => (
                    <ItemCliente key={c.id} c={c} href={link(c.id)} ativo={c.id === selecionado} agora={agora} />
                  ))}
                </Grupo>
              )}
              {grupos.outras.length > 0 && (
                <Grupo titulo="Com outras atendentes" contagem={grupos.outras.length} discreto>
                  {grupos.outras.map((c) => (
                    <ItemCliente key={c.id} c={c} href={link(c.id)} ativo={c.id === selecionado} agora={agora} />
                  ))}
                </Grupo>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Conversa aberta */}
      <section className={`flex-1 min-w-0 ${selecionado ? "flex" : "hidden md:flex"} flex-col`}>
        {conversa ? (
          <Conversa
            key={conversa.cliente.id}
            usuario={usuario}
            cliente={conversa.cliente}
            mensagens={conversa.mensagens}
            atendentes={props.atendentes}
            respostasRapidas={props.respostasRapidas}
            voltarHref={busca ? `/atendimento?busca=${encodeURIComponent(busca)}` : "/atendimento"}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <p className="text-xl font-heading font-semibold text-preto mb-2">Escolha um cliente na lista</p>
              <p className="text-cinza-medio">
                Os clientes em <span className="text-vermelho font-semibold">vermelho</span> estão esperando. Clique em um e depois em
                <span className="font-semibold"> “Pegar este cliente”</span>.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Grupo(props: {
  titulo: string;
  contagem?: number;
  destaque?: boolean;
  discreto?: boolean;
  vazio?: string;
  children: React.ReactNode;
}) {
  const temItens = Array.isArray(props.children) ? props.children.length > 0 : !!props.children;
  return (
    <div className="border-b border-cinza-claro">
      <div
        className={`px-4 py-2 flex items-center justify-between text-xs font-heading font-bold uppercase tracking-wide ${
          props.destaque ? "bg-vermelho text-white" : props.discreto ? "bg-offwhite text-cinza-medio" : "bg-offwhite text-preto"
        }`}
      >
        <span>{props.titulo}</span>
        {typeof props.contagem === "number" && <span>{props.contagem}</span>}
      </div>
      {temItens ? props.children : props.vazio ? <p className="px-4 py-3 text-sm text-cinza-medio">{props.vazio}</p> : null}
    </div>
  );
}

function ItemCliente({ c, href, ativo, agora }: { c: ClienteResumo; href: string; ativo: boolean; agora: number }) {
  const esperando = c.status === "aguardando";
  return (
    <Link
      href={href}
      className={`block px-4 py-3 border-t border-cinza-claro/60 first:border-t-0 transition ${
        ativo ? "bg-dourado/15" : esperando ? "bg-red-50 hover:bg-red-100" : "hover:bg-offwhite"
      }`}
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
        {c.assunto && (
          <span className="text-[11px] font-semibold rounded bg-preto/80 text-white px-1.5 py-0.5">{ROTULO_ASSUNTO[c.assunto]}</span>
        )}
        {c.numeroApelido && (
          <span className="text-[11px] font-semibold rounded border border-cinza-claro text-cinza-medio px-1.5 py-0.5">
            {c.numeroApelido}
          </span>
        )}
        {c.status === "atendendo" && c.atribuidoNome && (
          <span className="text-[11px] text-cinza-medio">com {c.atribuidoNome}</span>
        )}
      </div>
      {c.ultimaMensagem && (
        <p className={`mt-1 text-sm truncate ${c.ultimaDoCliente ? "text-preto" : "text-cinza-medio"}`}>{c.ultimaMensagem}</p>
      )}
    </Link>
  );
}
