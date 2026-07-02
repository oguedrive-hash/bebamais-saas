"use client";

import { useState, useTransition } from "react";
import {
  salvarProspeccaoConfig,
  type ProspeccaoRegra,
} from "../actions";
import { RegraCard } from "../_shared/regra-card";

const DEFAULT_REGRA: ProspeccaoRegra = {
  nivel: 1,
  esperar_dias: 0,
  esperar_horas: 0,
  esperar_minutos: 0,
  mensagem: "",
  ativo: true,
  tipo_midia: "texto",
  attachment_url: null,
  attachment_mime: null,
};

export function CadenciaForm({
  organizationId,
  regrasIniciais,
}: {
  organizationId: string;
  regrasIniciais: ProspeccaoRegra[];
}) {
  const [regras, setRegras] = useState<ProspeccaoRegra[]>(regrasIniciais);
  const [pending, startTransition] = useTransition();
  const [salvouAgora, setSalvouAgora] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function adicionarRegra() {
    const novaIdx = regras.length;
    setRegras((r) => [
      ...r,
      {
        ...DEFAULT_REGRA,
        nivel: r.length + 1,
        // Primeira regra: sem espera (disparo imediato no momento da importação).
        // Próximas: default de 2 dias após a anterior.
        esperar_dias: novaIdx === 0 ? 0 : 2,
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
  function atualizarRegra(idx: number, patch: Partial<ProspeccaoRegra>) {
    setRegras((r) =>
      r.map((reg, i) => (i === idx ? { ...reg, ...patch } : reg)),
    );
  }

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const result = await salvarProspeccaoConfig(organizationId, { regras });
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-heading font-bold text-preto">
              Cadência de prospecção
            </h3>
            <p className="text-xs text-cinza-medio mt-1">
              Mensagens disparadas pela IA em sequência após o lead ser
              importado. Mensagens são template fixo (sem personalização IA).
              Quando o lead responder, a cadência para e o fluxo de conversa
              normal assume.
            </p>
          </div>
          <button
            type="button"
            onClick={adicionarRegra}
            className="px-3 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold text-sm transition"
          >
            + Adicionar mensagem
          </button>
        </div>

        {regras.length === 0 ? (
          <p className="text-sm text-cinza-medio text-center py-8 bg-offwhite rounded-lg border border-cinza-claro">
            Nenhuma mensagem configurada. Sem cadência, os leads importados não
            recebem contato automático.
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
                onChange={(patch) => atualizarRegra(idx, patch)}
                onRemove={() => removerRegra(idx)}
                onMoverCima={() => moverRegra(idx, -1)}
                onMoverBaixo={() => moverRegra(idx, 1)}
              />
            ))}
          </div>
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
          {pending ? "Salvando..." : "Salvar cadência"}
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
