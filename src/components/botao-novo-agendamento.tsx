"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  buscarLeadsParaAgendamento,
  criarAgendamento,
} from "@/app/dashboard/agenda/actions";

type LeadResultado = {
  id: string;
  nome: string | null;
  telefone: string;
};

function localDatetimeMin(): string {
  // datetime-local quer YYYY-MM-DDTHH:mm sem timezone. Pegamos "agora" no
  // fuso do navegador pro min do input.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BotaoNovoAgendamento({
  duracoesConfig,
}: {
  duracoesConfig: number[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Form state
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<LeadResultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [leadEscolhido, setLeadEscolhido] = useState<LeadResultado | null>(
    null,
  );
  const [dataHora, setDataHora] = useState("");
  const [duracao, setDuracao] = useState(duracoesConfig[0] ?? 30);
  const [personalizado, setPersonalizado] = useState(false);
  const [observacoes, setObservacoes] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce 300ms na busca de leads
  useEffect(() => {
    if (leadEscolhido) return; // já escolheu, não busca mais
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = busca.trim();
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    debounceRef.current = setTimeout(async () => {
      const result = await buscarLeadsParaAgendamento(q);
      setBuscando(false);
      if ("error" in result) {
        setResultados([]);
        return;
      }
      setResultados(result.leads);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [busca, leadEscolhido]);

  function resetForm() {
    setBusca("");
    setResultados([]);
    setLeadEscolhido(null);
    setDataHora("");
    setDuracao(30);
    setPersonalizado(false);
    setObservacoes("");
    setErro(null);
  }

  function fechar() {
    if (pending) return;
    setAberto(false);
    resetForm();
  }

  function salvar() {
    setErro(null);
    if (!leadEscolhido) {
      setErro("Selecione um lead");
      return;
    }
    if (!dataHora) {
      setErro("Informe data e hora");
      return;
    }
    const form = new FormData();
    form.set("leadId", leadEscolhido.id);
    form.set("dataHora", dataHora);
    form.set("duracaoMin", String(duracao));
    form.set("observacoes", observacoes);
    startTransition(async () => {
      const result = await criarAgendamento(form);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      fechar();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold text-sm transition"
      >
        + Novo agendamento
      </button>

      {aberto && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={fechar}
        >
          <div
            className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-heading font-bold text-preto mb-4">
              Novo agendamento
            </h3>

            {/* Busca de lead OU lead escolhido */}
            {leadEscolhido ? (
              <div className="mb-4">
                <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
                  Lead
                </label>
                <div className="flex items-center justify-between gap-2 px-3 py-2 border border-cinza-claro rounded-lg bg-offwhite">
                  <div>
                    <p className="font-heading font-semibold text-preto text-sm">
                      {leadEscolhido.nome ?? "Sem nome"}
                    </p>
                    <p className="text-xs text-cinza-medio font-mono mt-0.5">
                      {leadEscolhido.telefone}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLeadEscolhido(null);
                      setBusca("");
                    }}
                    disabled={pending}
                    className="text-xs text-cinza-medio hover:text-preto underline disabled:opacity-40"
                  >
                    trocar
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-4 relative">
                <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
                  Lead
                </label>
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou telefone..."
                  className="w-full px-3 py-2 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition"
                  autoFocus
                />
                {(resultados.length > 0 || buscando) && (
                  <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-auto bg-white border border-cinza-claro rounded-lg shadow-lg z-10">
                    {buscando && (
                      <p className="px-3 py-2 text-xs text-cinza-medio">
                        Buscando...
                      </p>
                    )}
                    {!buscando &&
                      resultados.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => {
                            setLeadEscolhido(l);
                            setResultados([]);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-offwhite transition border-b border-cinza-claro last:border-0"
                        >
                          <p className="text-sm font-heading font-semibold text-preto">
                            {l.nome ?? "Sem nome"}
                          </p>
                          <p className="text-[10px] text-cinza-medio font-mono">
                            {l.telefone}
                          </p>
                        </button>
                      ))}
                  </div>
                )}
                {busca.length >= 2 &&
                  !buscando &&
                  resultados.length === 0 && (
                    <p className="text-xs text-cinza-medio mt-1">
                      Nenhum lead encontrado
                    </p>
                  )}
              </div>
            )}

            {/* Data e hora */}
            <div className="mb-4">
              <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
                Data e hora
              </label>
              <input
                type="datetime-local"
                value={dataHora}
                min={localDatetimeMin()}
                onChange={(e) => setDataHora(e.target.value)}
                className="w-full px-3 py-2 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition"
              />
            </div>

            {/* Duração */}
            <div className="mb-4">
              <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
                Duração
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {duracoesConfig.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => {
                      setDuracao(min);
                      setPersonalizado(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-heading font-semibold transition border ${
                      !personalizado && duracao === min
                        ? "bg-preto text-white border-preto"
                        : "bg-white text-cinza-medio border-cinza-claro hover:border-preto"
                    }`}
                  >
                    {min} min
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPersonalizado(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-heading font-semibold transition border ${
                    personalizado
                      ? "bg-preto text-white border-preto"
                      : "bg-white text-cinza-medio border-cinza-claro hover:border-preto"
                  }`}
                >
                  Personalizado
                </button>
              </div>
              {personalizado && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min={5}
                    max={480}
                    value={duracao}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setDuracao(n);
                    }}
                    className="w-24 px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition"
                  />
                  <span className="text-xs text-cinza-medio">
                    minutos (entre 5 e 480)
                  </span>
                </div>
              )}
            </div>

            {/* Observações */}
            <div className="mb-4">
              <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
                Observações (opcional)
              </label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={2}
                placeholder="ex: cliente pediu pra confirmar 1h antes"
                className="w-full px-3 py-2 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition resize-none"
              />
            </div>

            {erro && (
              <p className="text-xs text-red-600 mb-3">{erro}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={fechar}
                disabled={pending}
                className="px-4 py-2 text-sm font-heading text-cinza-medio hover:text-preto transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={pending || !leadEscolhido || !dataHora}
                className="px-4 py-2 bg-laranja text-white text-sm font-heading font-semibold rounded-lg hover:bg-laranja-escuro disabled:opacity-50 transition"
              >
                {pending ? "Criando..." : "Criar agendamento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
