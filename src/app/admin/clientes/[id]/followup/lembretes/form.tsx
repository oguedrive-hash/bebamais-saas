"use client";

import { useState, useTransition } from "react";
import {
  salvarFollowupConfig,
  type LembreteReuniaoRegra,
} from "../actions";
import { LembreteCard } from "../_shared/lembrete-card";

const DEFAULT_LEMBRETE: LembreteReuniaoRegra = {
  nivel: 1,
  quando: "antes",
  tempo_dias: 0,
  tempo_horas: 1,
  tempo_minutos: 0,
  mensagem: "",
  usa_ia: false,
  ativo: true,
  tipo_midia: "texto",
  attachment_url: null,
  attachment_mime: null,
};

export function LembretesForm({
  organizationId,
  regrasIniciais,
}: {
  organizationId: string;
  regrasIniciais: LembreteReuniaoRegra[];
}) {
  const [regras, setRegras] =
    useState<LembreteReuniaoRegra[]>(regrasIniciais);
  const [pending, startTransition] = useTransition();
  const [salvouAgora, setSalvouAgora] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function adicionar() {
    setRegras((l) => [...l, { ...DEFAULT_LEMBRETE, nivel: l.length + 1 }]);
  }
  function remover(idx: number) {
    setRegras((l) => l.filter((_, i) => i !== idx));
  }
  function atualizar(idx: number, patch: Partial<LembreteReuniaoRegra>) {
    setRegras((l) =>
      l.map((reg, i) => (i === idx ? { ...reg, ...patch } : reg)),
    );
  }

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const result = await salvarFollowupConfig(organizationId, {
        lembretesAntes: regras,
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-heading font-bold text-preto">
              Lembretes de retirada agendada
            </h3>
            <p className="text-xs text-cinza-medio mt-1">
              Quando um cliente tem retirada agendada, dispara lembretes em momentos
              específicos antes do horário marcado.
            </p>
          </div>
          <button
            type="button"
            onClick={adicionar}
            className="px-3 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold text-sm transition"
          >
            + Adicionar lembrete
          </button>
        </div>

        {regras.length === 0 ? (
          <p className="text-sm text-cinza-medio text-center py-8 bg-offwhite rounded-lg border border-cinza-claro">
            Nenhum lembrete configurado. Reuniões agendadas não vão ter aviso
            automático antes.
          </p>
        ) : (
          <div className="space-y-4">
            {regras.map((reg, idx) => (
              <LembreteCard
                key={idx}
                regra={reg}
                idx={idx}
                contexto="antes"
                onChange={(patch) => atualizar(idx, patch)}
                onRemove={() => remover(idx)}
              />
            ))}
          </div>
        )}

        <p className="text-[10px] text-cinza-medio mt-3">
          Placeholders disponíveis: {"{nome}"}, {"{hora}"}, {"{data}"},{" "}
          {"{meet_link}"}
        </p>
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
          {pending ? "Salvando..." : "Salvar lembretes"}
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
