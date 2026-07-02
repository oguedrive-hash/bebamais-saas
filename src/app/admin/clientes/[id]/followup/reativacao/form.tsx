"use client";

import { useState, useTransition } from "react";
import {
  salvarFollowupConfig,
  type FollowupReativacao,
  type ReativacaoRegra,
} from "../actions";
import { RegraCard } from "../_shared/regra-card";

const DEFAULT_REGRA: ReativacaoRegra = {
  nivel: 1,
  esperar_dias: 30,
  esperar_horas: 0,
  esperar_minutos: 0,
  mensagem: "",
  usa_ia: true,
  ativo: true,
  tipo_midia: "texto",
  attachment_url: null,
  attachment_mime: null,
};

export function ReativacaoForm({
  organizationId,
  reativacaoInicial,
}: {
  organizationId: string;
  reativacaoInicial: FollowupReativacao;
}) {
  const [ativa, setAtiva] = useState<boolean>(reativacaoInicial.ativa);
  const [regras, setRegras] = useState<ReativacaoRegra[]>(
    reativacaoInicial.regras,
  );
  const [pending, startTransition] = useTransition();
  const [salvouAgora, setSalvouAgora] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function adicionarRegra() {
    setRegras((r) => [
      ...r,
      {
        ...DEFAULT_REGRA,
        nivel: r.length + 1,
        // Primeira regra: 30 dias após fim do follow-up. Próximas: 7 dias após anterior.
        esperar_dias: r.length === 0 ? 30 : 7,
      },
    ]);
  }
  function removerRegra(idx: number) {
    setRegras((r) => r.filter((_, i) => i !== idx));
  }
  function moverRegra(idx: number, delta: -1 | 1) {
    setRegras((r) => {
      const novo = [...r];
      const target = idx + delta;
      if (target < 0 || target >= novo.length) return r;
      [novo[idx], novo[target]] = [novo[target], novo[idx]];
      return novo;
    });
  }
  function atualizarRegra(idx: number, patch: Partial<ReativacaoRegra>) {
    setRegras((r) =>
      r.map((reg, i) => (i === idx ? { ...reg, ...patch } : reg)),
    );
  }

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const result = await salvarFollowupConfig(organizationId, {
        reativacao: { ativa, regras },
      });
      if ("error" in result) {
        setErro(result.error);
      } else {
        setSalvouAgora(true);
        setTimeout(() => setSalvouAgora(false), 3000);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-heading font-bold text-preto">
              Reativação de leads perdidos
            </h3>
            <p className="text-xs text-cinza-medio mt-1">
              Depois que a IA esgotar a cadência principal, dispara mensagens
              de reativação em intervalos. Cada regra é relativa à anterior.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ativa}
              onChange={(e) => setAtiva(e.target.checked)}
              className="w-4 h-4 rounded text-laranja focus:ring-laranja"
            />
            <span className="text-sm font-heading font-semibold text-preto">
              Ativar
            </span>
          </label>
        </div>

        {ativa && (
          <>
            <div className="flex items-center justify-end mb-3">
              <button
                type="button"
                onClick={adicionarRegra}
                className="px-3 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold text-sm transition"
              >
                + Adicionar regra
              </button>
            </div>

            {regras.length === 0 ? (
              <p className="text-sm text-cinza-medio text-center py-8 bg-offwhite rounded-lg border border-cinza-claro">
                Nenhuma regra de reativação. Adicione pelo menos uma pra que a
                reativação faça algo.
              </p>
            ) : (
              <div className="space-y-4">
                {regras.map((regra, idx) => (
                  <RegraCard
                    key={idx}
                    regra={regra}
                    idx={idx}
                    ehPrimeira={idx === 0}
                    ehUltima={idx === regras.length - 1}
                    total={regras.length}
                    contexto="reativacao"
                    onChange={(patch) => atualizarRegra(idx, patch)}
                    onRemove={() => removerRegra(idx)}
                    onMoverCima={() => moverRegra(idx, -1)}
                    onMoverBaixo={() => moverRegra(idx, 1)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {erro && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-cinza-claro">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="px-5 py-3 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja-claro text-white font-heading font-semibold transition"
        >
          {pending ? "Salvando..." : "Salvar reativação"}
        </button>
        {salvouAgora && (
          <span className="text-sm text-green-700 font-heading font-semibold">
            ✓ Salvo
          </span>
        )}
      </div>
    </div>
  );
}
