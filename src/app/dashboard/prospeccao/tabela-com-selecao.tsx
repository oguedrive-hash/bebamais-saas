"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusSelector } from "@/components/status-selector";
import { type StatusLead } from "@/lib/status-config";
import {
  dispararPrimeirasMensagensEmLote,
  type RelatorioDisparo,
} from "./actions";
import { moverLeadsParaInbound } from "../leads/voltar-inbound-actions";

type Lead = {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  caio_ativo: boolean | null;
  numero_prospeccao: number | null;
  dados_extras: Record<string, string> | null;
  created_at: string;
  updated_at: string;
};

export function TabelaComSelecao({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pendingDispatch, startDispatch] = useTransition();
  const [pendingMover, startMover] = useTransition();
  const [relatorio, setRelatorio] = useState<RelatorioDisparo | null>(null);
  const [erroDispatch, setErroDispatch] = useState<string | null>(null);
  const [resultadoMover, setResultadoMover] = useState<{
    movidos: number;
    pulados: number;
  } | null>(null);
  const [erroMover, setErroMover] = useState<string | null>(null);

  // Todos os leads podem ser selecionados pra "Voltar pra Inbound".
  // "Disparar agora" só atua nos que estão em aguardando_primeiro_contato.
  const ids = useMemo(() => leads.map((l) => l.id), [leads]);
  const idsAguardando = useMemo(
    () =>
      new Set(
        leads
          .filter((l) => l.status === "aguardando_primeiro_contato")
          .map((l) => l.id),
      ),
    [leads],
  );

  const totalSelecionados = selecionados.size;
  const todosMarcados =
    ids.length > 0 && totalSelecionados === ids.length;
  const algunsMarcados =
    totalSelecionados > 0 && totalSelecionados < ids.length;

  // Quantos dos selecionados estão em aguardando (podem ser disparados)
  const podeDispatch = useMemo(
    () => Array.from(selecionados).every((id) => idsAguardando.has(id)),
    [selecionados, idsAguardando],
  );

  function toggleLead(id: string) {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function toggleTodos() {
    setSelecionados((s) => {
      if (s.size === ids.length) return new Set();
      return new Set(ids);
    });
  }

  function dispararLote() {
    setErroDispatch(null);
    setRelatorio(null);
    const idsSel = Array.from(selecionados);
    startDispatch(async () => {
      const result = await dispararPrimeirasMensagensEmLote(idsSel);
      if ("error" in result) {
        setErroDispatch(result.error);
      } else {
        setRelatorio(result.relatorio);
        setSelecionados(new Set());
        router.refresh();
      }
    });
  }

  function voltarLote() {
    setErroMover(null);
    setResultadoMover(null);
    const idsSel = Array.from(selecionados);
    startMover(async () => {
      const result = await moverLeadsParaInbound(idsSel);
      if ("error" in result) {
        setErroMover(result.error);
      } else {
        setResultadoMover({
          movidos: result.relatorio.movidos,
          pulados: result.relatorio.pulados.length,
        });
        setSelecionados(new Set());
        router.refresh();
      }
    });
  }

  const pending = pendingDispatch || pendingMover;

  return (
    <>
      {/* Toolbar */}
      {(totalSelecionados > 0 || relatorio || resultadoMover) && (
        <div className="flex items-center justify-between gap-3 mb-3 p-3 rounded-lg bg-laranja/5 border border-laranja/20">
          <div className="flex items-center gap-3 text-sm">
            {totalSelecionados > 0 ? (
              <>
                <span className="text-preto">
                  <strong>{totalSelecionados}</strong> lead
                  {totalSelecionados > 1 ? "s" : ""} selecionado
                  {totalSelecionados > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setSelecionados(new Set())}
                  className="text-xs text-cinza-medio hover:text-preto underline"
                >
                  limpar
                </button>
              </>
            ) : null}
            {relatorio && (
              <span className="text-xs text-emerald-700">
                ✓ {relatorio.agendados} agendado
                {relatorio.agendados !== 1 ? "s" : ""} (1º sai em segundos)
                {relatorio.falhas.length > 0 &&
                  ` · ${relatorio.falhas.length} falha${relatorio.falhas.length !== 1 ? "s" : ""}`}
              </span>
            )}
            {resultadoMover && (
              <span className="text-xs text-emerald-700">
                ✓ {resultadoMover.movidos} movido
                {resultadoMover.movidos !== 1 ? "s" : ""} pra Inbound
                {resultadoMover.pulados > 0 &&
                  ` · ${resultadoMover.pulados} pulado${resultadoMover.pulados !== 1 ? "s" : ""}`}
              </span>
            )}
          </div>
          {totalSelecionados > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={voltarLote}
                disabled={pending}
                className="px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto hover:border-preto disabled:opacity-40 font-heading font-semibold text-sm transition"
              >
                {pendingMover ? "..." : "← Voltar pra Inbound"}
              </button>
              <button
                type="button"
                onClick={dispararLote}
                disabled={pending || !podeDispatch}
                title={
                  podeDispatch
                    ? "Dispara primeira mensagem"
                    : "Só pra leads em 'Aguardando 1ª msg'"
                }
                className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja/40 disabled:cursor-not-allowed text-white font-heading font-semibold text-sm transition"
              >
                {pendingDispatch ? "Disparando..." : "🚀 Disparar agora"}
              </button>
            </div>
          )}
        </div>
      )}

      {(erroDispatch || erroMover) && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 mb-3">
          <p className="text-sm text-red-800">
            {erroDispatch || erroMover}
          </p>
        </div>
      )}

      {relatorio && relatorio.falhas.length > 0 && (
        <div className="p-3 rounded-lg bg-offwhite border border-cinza-claro mb-3">
          <details>
            <summary className="text-xs cursor-pointer text-cinza-medio">
              Detalhes das falhas ({relatorio.falhas.length})
            </summary>
            <ul className="text-[10px] mt-1 space-y-0.5 max-h-32 overflow-auto">
              {relatorio.falhas.map((f, i) => (
                <li key={i} className="text-cinza-medio">
                  {f.nome ?? "?"}: {f.motivo}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-cinza-claro">
        <table className="w-full">
          <thead className="bg-offwhite border-b border-cinza-claro">
            <tr>
              <Th className="w-10">
                <input
                  type="checkbox"
                  checked={todosMarcados}
                  ref={(el) => {
                    if (el) el.indeterminate = algunsMarcados;
                  }}
                  onChange={toggleTodos}
                  className="w-4 h-4 rounded text-laranja focus:ring-laranja cursor-pointer"
                  aria-label="Selecionar todos"
                />
              </Th>
              <Th>Nome / Telefone</Th>
              <Th>Status</Th>
              <Th>Msgs enviadas</Th>
              <Th>Importado em</Th>
              <Th className="text-right">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const marcado = selecionados.has(lead.id);
              return (
                <tr
                  key={lead.id}
                  className={`border-b border-cinza-claro last:border-0 hover:bg-offwhite/50 transition ${
                    marcado ? "bg-laranja/5" : ""
                  }`}
                >
                  <Td>
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => toggleLead(lead.id)}
                      className="w-4 h-4 rounded text-laranja focus:ring-laranja cursor-pointer"
                    />
                  </Td>
                  <Td>
                    <div>
                      <p className="font-heading font-semibold text-preto">
                        {lead.nome ?? "Sem nome"}
                      </p>
                      <p className="text-xs text-cinza-medio font-mono mt-0.5">
                        {lead.telefone}
                      </p>
                      {Object.keys(lead.dados_extras ?? {}).length > 0 && (
                        <p className="text-[10px] text-cinza-medio mt-1">
                          {Object.entries(lead.dados_extras ?? {})
                            .slice(0, 2)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1.5">
                      <StatusSelector
                        leadId={lead.id}
                        statusAtual={lead.status as StatusLead}
                        incluirProspeccao
                      />
                      <CaioBadge ativo={lead.caio_ativo ?? true} />
                    </div>
                  </Td>
                  <Td>
                    <span className="text-sm text-preto font-heading font-semibold">
                      {lead.numero_prospeccao ?? 0}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-sm text-cinza-medio">
                      {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/dashboard/contatos/${lead.id}?from=prospeccao`}
                      className="text-sm text-laranja hover:text-laranja-escuro font-heading font-semibold"
                    >
                      Ver →
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-6 py-3 text-left text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-6 py-4 ${className}`}>{children}</td>;
}

function CaioBadge({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold border ${
        ativo
          ? "bg-green-50 text-green-700 border-green-300"
          : "bg-red-50 text-red-700 border-red-300"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${ativo ? "bg-green-500" : "bg-red-500"}`}
      />
      {ativo ? "Caio respondendo" : "Caio desligado"}
    </span>
  );
}
