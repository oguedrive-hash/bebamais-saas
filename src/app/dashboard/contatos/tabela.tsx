"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATUS_CONFIG, type StatusLead } from "@/lib/status-config";
import { moverLeadsParaProspeccao } from "../leads/mover-prospeccao-actions";
import { moverLeadsParaInbound } from "../leads/voltar-inbound-actions";
import {
  criarContatoAvulso,
  importarContatosLote,
  type ComoOrigem,
  type LeadImport,
  type RelatorioImportacao,
} from "./actions";

type Lead = {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  origem: string;
  updated_at: string;
  created_at: string;
};

const CSV_TEMPLATE =
  "nome,telefone,empresa,segmento\nJoão Silva,5511999998888,Acme Co,SaaS\nMaria Souza,(11) 98888-7777,Beta Ltda,Varejo\n";

function parseCsv(texto: string): { headers: string[]; linhas: string[][] } {
  const linhasRaw = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (linhasRaw.length === 0) return { headers: [], linhas: [] };
  const headers = linhasRaw[0].split(",").map((c) => c.trim().toLowerCase());
  const linhas = linhasRaw
    .slice(1)
    .map((l) => l.split(",").map((c) => c.trim()));
  return { headers, linhas };
}

function csvParaLeads(headers: string[], linhas: string[][]): LeadImport[] {
  const idxNome = headers.indexOf("nome");
  const idxTel = headers.indexOf("telefone");
  return linhas.map((cells) => {
    const dados_extras: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h !== "nome" && h !== "telefone" && cells[i]) {
        dados_extras[h] = cells[i];
      }
    });
    return {
      nome: idxNome >= 0 ? cells[idxNome] ?? "" : "",
      telefone: idxTel >= 0 ? cells[idxTel] ?? "" : "",
      dados_extras,
    };
  });
}

// Prospecção desligada por enquanto (operação 100% inbound). O mecanismo de
// seleção/mover entre Inbound e Prospecção continua no código — pra reativar,
// basta voltar pra true.
const PROSPECCAO_ATIVA = false;

export function ContatosTabela({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pendingMover, startMover] = useTransition();
  const [resultadoMover, setResultadoMover] = useState<{
    acao: "prospeccao" | "inbound";
    movidos: number;
    pulados: number;
  } | null>(null);
  const [erroMover, setErroMover] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);

  const ids = useMemo(() => leads.map((l) => l.id), [leads]);
  const todosMarcados = ids.length > 0 && selecionados.size === ids.length;
  const algunsMarcados =
    selecionados.size > 0 && selecionados.size < ids.length;

  function toggle(id: string) {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }
  function toggleTodos() {
    setSelecionados((s) =>
      s.size === ids.length ? new Set() : new Set(ids),
    );
  }

  function mover(acao: "prospeccao" | "inbound") {
    setErroMover(null);
    setResultadoMover(null);
    const idsSel = Array.from(selecionados);
    startMover(async () => {
      const result =
        acao === "prospeccao"
          ? await moverLeadsParaProspeccao(idsSel)
          : await moverLeadsParaInbound(idsSel);
      if ("error" in result) {
        setErroMover(result.error);
        return;
      }
      const movidos =
        "movidos" in result.relatorio ? result.relatorio.movidos : 0;
      const pulados =
        "pulados" in result.relatorio ? result.relatorio.pulados.length : 0;
      setResultadoMover({ acao, movidos, pulados });
      setSelecionados(new Set());
      router.refresh();
    });
  }

  return (
    <>
      {/* Com prospecção desligada, o botão de importar mora na linha do
          título (BotaoImportarContatos, renderizado pela page). */}
      {PROSPECCAO_ATIVA && (
        <Toolbar
          totalSelecionados={selecionados.size}
          onMover={mover}
          onAbrirImportar={() => setModalAberto(true)}
          onLimpar={() => setSelecionados(new Set())}
          pending={pendingMover}
          erro={erroMover}
          resultado={resultadoMover}
          onFecharResultado={() => setResultadoMover(null)}
        />
      )}

      <div className="bg-white rounded-2xl border border-cinza-claro">
        <table className="w-full">
          <thead className="bg-offwhite border-b border-cinza-claro">
            <tr>
              {PROSPECCAO_ATIVA && (
                <th className="w-10 px-4 py-3">
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
                </th>
              )}
              <Th>Nome / Telefone</Th>
              {PROSPECCAO_ATIVA && <Th>Origem</Th>}
              <Th>Status</Th>
              <Th>Última atividade</Th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => router.push(`/dashboard/contatos/${lead.id}`)}
                className={`border-b border-cinza-claro last:border-0 hover:bg-offwhite/50 transition cursor-pointer ${
                  selecionados.has(lead.id) ? "bg-laranja/5" : ""
                }`}
              >
                {PROSPECCAO_ATIVA && (
                  <td
                    className="w-10 px-4 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selecionados.has(lead.id)}
                      onChange={() => toggle(lead.id)}
                      className="w-4 h-4 rounded text-laranja focus:ring-laranja cursor-pointer"
                    />
                  </td>
                )}
                <Td>
                  <p className="font-heading font-semibold text-preto">
                    {lead.nome ?? "Sem nome"}
                    <span className="text-xs text-cinza-medio font-mono font-normal ml-2">
                      {lead.telefone}
                    </span>
                  </p>
                </Td>
                {PROSPECCAO_ATIVA && (
                  <Td>
                    <OrigemBadge origem={lead.origem} />
                  </Td>
                )}
                <Td>
                  <StatusBadge status={lead.status} />
                </Td>
                <Td>
                  <span className="text-sm text-cinza-medio">
                    {formatRelativeDate(lead.updated_at)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalAberto && (
        <ImportarModal onFechar={() => setModalAberto(false)} />
      )}
    </>
  );
}

// Botão + modal de importação — renderizado pela page na linha do título,
// pra não gastar uma linha inteira da tela só com ele.
export function BotaoImportarContatos() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto hover:border-laranja hover:text-laranja font-heading font-semibold text-sm transition whitespace-nowrap"
      >
        + Importar contatos
      </button>
      {aberto && <ImportarModal onFechar={() => setAberto(false)} />}
    </>
  );
}

function Toolbar({
  totalSelecionados,
  onMover,
  onAbrirImportar,
  onLimpar,
  pending,
  erro,
  resultado,
  onFecharResultado,
}: {
  totalSelecionados: number;
  onMover: (a: "prospeccao" | "inbound") => void;
  onAbrirImportar: () => void;
  onLimpar: () => void;
  pending: boolean;
  erro: string | null;
  resultado: { acao: "prospeccao" | "inbound"; movidos: number; pulados: number } | null;
  onFecharResultado: () => void;
}) {
  return (
    <div className="sticky top-[72px] z-10 mb-3 p-3 rounded-lg bg-laranja/5 border border-laranja/20 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 text-sm">
        {totalSelecionados > 0 ? (
          <>
            <span className="text-preto">
              <strong>{totalSelecionados}</strong> contato
              {totalSelecionados > 1 ? "s" : ""} selecionado
              {totalSelecionados > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={onLimpar}
              className="text-xs text-cinza-medio hover:text-preto underline"
            >
              limpar
            </button>
          </>
        ) : (
          <span className="text-cinza-medio">
            Selecione contatos pra mover entre Inbound e Prospecção
          </span>
        )}
        {resultado && (
          <span className="text-xs text-emerald-700">
            ✓ {resultado.movidos} movido
            {resultado.movidos !== 1 ? "s" : ""} pra{" "}
            {resultado.acao === "prospeccao" ? "Prospecção" : "Inbound"}
            {resultado.pulados > 0 &&
              ` · ${resultado.pulados} pulado${resultado.pulados !== 1 ? "s" : ""}`}
            <button
              type="button"
              onClick={onFecharResultado}
              className="ml-2 text-cinza-medio hover:text-preto"
            >
              ✕
            </button>
          </span>
        )}
        {erro && <span className="text-xs text-red-700">{erro}</span>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAbrirImportar}
          className="px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto hover:border-laranja hover:text-laranja font-heading font-semibold text-sm transition"
        >
          + Importar contatos
        </button>
        {totalSelecionados > 0 && (
          <>
            <button
              type="button"
              onClick={() => onMover("inbound")}
              disabled={pending}
              className="px-4 py-2 rounded-lg border border-cinza-claro bg-white text-preto hover:border-laranja hover:text-laranja disabled:opacity-40 font-heading font-semibold text-sm transition"
            >
              {pending ? "..." : "← Voltar pra Inbound"}
            </button>
            <button
              type="button"
              onClick={() => onMover("prospeccao")}
              disabled={pending}
              className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja/40 text-white font-heading font-semibold text-sm transition"
            >
              {pending ? "Movendo..." : "🎯 Enviar pra Prospecção"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ImportarModal({ onFechar }: { onFechar: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aba, setAba] = useState<"csv" | "avulso">("csv");
  // Com prospecção desligada, tudo entra como inbound (contato base).
  const [como, setComo] = useState<ComoOrigem>(
    PROSPECCAO_ATIVA ? "prospeccao" : "inbound",
  );
  const [preview, setPreview] = useState<LeadImport[]>([]);
  const [previewErro, setPreviewErro] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);
  const [pending, startTransition] = useTransition();

  const [nomeAvulso, setNomeAvulso] = useState("");
  const [telAvulso, setTelAvulso] = useState("");
  const [extrasAvulso, setExtrasAvulso] = useState("");
  const [erroAvulso, setErroAvulso] = useState<string | null>(null);
  const [okAvulso, setOkAvulso] = useState(false);

  function baixarTemplate() {
    const blob = new Blob([CSV_TEMPLATE], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contatos-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewErro(null);
    setRelatorio(null);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, linhas } = parseCsv(reader.result as string);
      if (!headers.includes("nome") || !headers.includes("telefone")) {
        setPreviewErro(
          "CSV precisa ter colunas 'nome' e 'telefone' (primeira linha).",
        );
        setPreview([]);
        return;
      }
      setPreview(csvParaLeads(headers, linhas));
    };
    reader.readAsText(file);
  }

  function confirmarCsv() {
    if (preview.length === 0) return;
    setRelatorio(null);
    startTransition(async () => {
      const result = await importarContatosLote(preview, como);
      if ("error" in result) {
        setPreviewErro(result.error);
      } else {
        setRelatorio(result.relatorio);
        setPreview([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        router.refresh();
      }
    });
  }

  function salvarAvulso() {
    setErroAvulso(null);
    setOkAvulso(false);
    if (!nomeAvulso.trim() || !telAvulso.trim()) {
      setErroAvulso("Nome e telefone são obrigatórios");
      return;
    }
    let extras: Record<string, string> = {};
    if (extrasAvulso.trim()) {
      try {
        if (extrasAvulso.trim().startsWith("{")) {
          extras = JSON.parse(extrasAvulso);
        } else {
          extrasAvulso.split(/[;\n]/).forEach((par) => {
            const [k, ...rest] = par.split("=");
            if (k && rest.length > 0) {
              extras[k.trim().toLowerCase()] = rest.join("=").trim();
            }
          });
        }
      } catch {
        setErroAvulso("Dados extras em formato inválido");
        return;
      }
    }
    startTransition(async () => {
      const result = await criarContatoAvulso(
        {
          nome: nomeAvulso,
          telefone: telAvulso,
          dados_extras: extras,
        },
        como,
      );
      if ("error" in result) {
        setErroAvulso(result.error);
      } else {
        setOkAvulso(true);
        setNomeAvulso("");
        setTelAvulso("");
        setExtrasAvulso("");
        router.refresh();
        setTimeout(() => setOkAvulso(false), 3000);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onFechar}
    >
      <div
        className="bg-white rounded-2xl border border-cinza-claro w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-cinza-claro">
          <h3 className="text-lg font-heading font-bold text-preto">
            Importar contatos
          </h3>
          <button
            type="button"
            onClick={onFechar}
            className="text-cinza-medio hover:text-preto text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Toggle de origem — escondido enquanto prospecção estiver desligada */}
        {PROSPECCAO_ATIVA && (
        <div className="p-4 border-b border-cinza-claro">
          <p className="text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
            Importar como
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setComo("prospeccao")}
              className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-heading font-semibold border transition ${
                como === "prospeccao"
                  ? "bg-laranja text-white border-laranja"
                  : "bg-white text-preto border-cinza-claro hover:border-laranja"
              }`}
            >
              🎯 Prospecção
              <span
                className={`block text-[10px] mt-0.5 ${como === "prospeccao" ? "text-white/80" : "text-cinza-medio"}`}
              >
                Entra na fila de &quot;Aguardando 1ª msg&quot;, pronto pra
                disparar
              </span>
            </button>
            <button
              type="button"
              onClick={() => setComo("inbound")}
              className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-heading font-semibold border transition ${
                como === "inbound"
                  ? "bg-preto text-white border-preto"
                  : "bg-white text-preto border-cinza-claro hover:border-preto"
              }`}
            >
              📥 Inbound (sem cadência)
              <span
                className={`block text-[10px] mt-0.5 ${como === "inbound" ? "text-white/80" : "text-cinza-medio"}`}
              >
                Vira contato base, espera o cliente mandar msg
              </span>
            </button>
          </div>
        </div>
        )}

        {/* Abas: CSV ou avulso */}
        <div className="flex border-b border-cinza-claro">
          <AbaButton
            label="📋 Lote (CSV)"
            ativo={aba === "csv"}
            onClick={() => setAba("csv")}
          />
          <AbaButton
            label="👤 Avulso"
            ativo={aba === "avulso"}
            onClick={() => setAba("avulso")}
          />
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {aba === "csv" ? (
            <>
              <p className="text-xs text-cinza-medio">
                Colunas obrigatórias: <code>nome</code>, <code>telefone</code>.
                Outras colunas viram placeholders (ex: <code>{"{empresa}"}</code>
                ).
              </p>
              <button
                type="button"
                onClick={baixarTemplate}
                className="text-sm text-laranja hover:underline font-heading font-semibold"
              >
                ↓ Baixar template CSV
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleArquivo}
                className="block w-full text-xs text-cinza-medio file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-cinza-claro file:bg-white file:text-preto file:font-heading file:font-semibold file:text-xs hover:file:border-laranja cursor-pointer"
              />
              {previewErro && (
                <p className="text-xs text-red-700">{previewErro}</p>
              )}
              {preview.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-heading font-semibold text-preto">
                      Prévia ({preview.length} linhas)
                    </p>
                    <button
                      type="button"
                      onClick={confirmarCsv}
                      disabled={pending}
                      className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja/40 text-white font-heading font-semibold text-sm transition"
                    >
                      {pending ? "Importando..." : "Confirmar"}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-auto border border-cinza-claro rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-offwhite sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-heading">Nome</th>
                          <th className="text-left p-2 font-heading">
                            Telefone
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.slice(0, 30).map((l, i) => (
                          <tr key={i} className="border-t border-cinza-claro">
                            <td className="p-2">{l.nome}</td>
                            <td className="p-2 font-mono">{l.telefone}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.length > 30 && (
                      <p className="p-2 text-[10px] text-cinza-medio text-center">
                        ...e mais {preview.length - 30}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {relatorio && (
                <div className="p-3 rounded-lg bg-offwhite border border-cinza-claro">
                  <p className="text-sm font-heading font-semibold text-preto mb-1">
                    Resultado
                  </p>
                  <ul className="text-xs space-y-0.5">
                    <li className="text-emerald-700">
                      ✓ Importados: <strong>{relatorio.importados}</strong>
                    </li>
                    {relatorio.reativados > 0 && (
                      <li className="text-blue-700">
                        ↻ Reativados: <strong>{relatorio.reativados}</strong>
                      </li>
                    )}
                    {relatorio.pulados > 0 && (
                      <li className="text-amber-700">
                        ⚠ Pulados: <strong>{relatorio.pulados}</strong>
                      </li>
                    )}
                    {relatorio.invalidos > 0 && (
                      <li className="text-red-700">
                        ✕ Inválidos: <strong>{relatorio.invalidos}</strong>
                      </li>
                    )}
                  </ul>
                  {relatorio.erros.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs cursor-pointer text-cinza-medio">
                        Ver detalhes ({relatorio.erros.length})
                      </summary>
                      <ul className="text-[10px] mt-1 space-y-0.5 max-h-32 overflow-auto">
                        {relatorio.erros.map((e, i) => (
                          <li key={i} className="text-cinza-medio">
                            linha {e.linha}: {e.motivo}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
                    Nome *
                  </label>
                  <input
                    type="text"
                    value={nomeAvulso}
                    onChange={(e) => setNomeAvulso(e.target.value)}
                    placeholder="João Silva"
                    className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
                    Telefone *
                  </label>
                  <input
                    type="text"
                    value={telAvulso}
                    onChange={(e) => setTelAvulso(e.target.value)}
                    placeholder="11999998888"
                    className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition text-sm font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
                  Dados extras (opcional)
                </label>
                <textarea
                  rows={2}
                  value={extrasAvulso}
                  onChange={(e) => setExtrasAvulso(e.target.value)}
                  placeholder="empresa=Acme; segmento=SaaS"
                  className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition text-sm font-mono"
                />
              </div>
              {erroAvulso && (
                <p className="text-xs text-red-700">{erroAvulso}</p>
              )}
              {okAvulso && (
                <p className="text-xs text-emerald-700 font-heading font-semibold">
                  ✓ Contato criado
                </p>
              )}
              <button
                type="button"
                onClick={salvarAvulso}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja/40 text-white font-heading font-semibold text-sm transition"
              >
                {pending ? "Salvando..." : "Adicionar contato"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AbaButton({
  label,
  ativo,
  onClick,
}: {
  label: string;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-heading font-semibold border-b-2 transition ${
        ativo
          ? "border-laranja text-preto"
          : "border-transparent text-cinza-medio hover:text-preto"
      }`}
    >
      {label}
    </button>
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
  return <td className={`px-6 py-2.5 ${className}`}>{children}</td>;
}

function OrigemBadge({ origem }: { origem: string }) {
  if (origem === "prospeccao") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading font-semibold border bg-blue-50 text-blue-700 border-blue-300">
        🎯 Prospecção
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading font-semibold border bg-cinza-claro/40 text-cinza-medio border-cinza-claro">
      📥 Inbound
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const conf = STATUS_CONFIG[status as StatusLead];
  if (!conf) {
    return (
      <span className="text-xs text-cinza-medio">{status}</span>
    );
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading font-semibold border ${conf.bg} ${conf.cor} ${conf.border}`}
    >
      {conf.label}
    </span>
  );
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min atrás`;
  if (diffHrs < 24) return `${diffHrs}h atrás`;
  if (diffDays < 7) return `${diffDays}d atrás`;
  return date.toLocaleDateString("pt-BR");
}
