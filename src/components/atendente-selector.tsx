"use client";

import { useState, useTransition, useEffect } from "react";
import { trocarAtendente } from "@/app/dashboard/leads/[id]/actions";

/**
 * Seletor manual de qual número/persona do pool atende este lead (override).
 * Só aparece quando a org tem 2+ números. A IA on/off é o ToggleCaio (separado).
 */
export function AtendenteSelector({
  leadId,
  atual,
  opcoes,
}: {
  leadId: string;
  atual: string | null;
  opcoes: { instance_name: string; persona_nome: string | null }[];
}) {
  const [valor, setValor] = useState(atual ?? "");
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Acompanha o valor do banco quando o parent re-renderiza (realtime), sem
  // atropelar o optimistic enquanto pending.
  useEffect(() => {
    if (!pending) setValor(atual ?? "");
  }, [atual, pending]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const novo = e.target.value;
    const anterior = valor;
    setErro(null);
    setValor(novo); // optimistic
    const form = new FormData();
    form.set("leadId", leadId);
    form.set("instance", novo);
    startTransition(async () => {
      const r = await trocarAtendente(form);
      if ("error" in r) {
        setErro(r.error);
        setValor(anterior); // rollback
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-heading font-medium text-cinza-medio">Atendente</span>
        <select
          value={valor}
          onChange={handleChange}
          disabled={pending}
          className="text-sm font-heading font-medium text-preto bg-white border border-cinza-claro rounded-lg px-2 py-1 focus:outline-none focus:border-laranja transition disabled:opacity-50"
        >
          {!atual && <option value="">— selecione —</option>}
          {opcoes.map((o) => (
            <option key={o.instance_name} value={o.instance_name}>
              {o.persona_nome ?? o.instance_name}
            </option>
          ))}
        </select>
      </div>
      {erro && <span className="text-xs text-red-500">{erro}</span>}
    </div>
  );
}
