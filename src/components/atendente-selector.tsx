"use client";

import { useState, useTransition, useEffect } from "react";
import { trocarAtendente } from "@/app/dashboard/leads/[id]/actions";

/**
 * Seletor manual de qual número/persona do pool atende este lead (override).
 * Só aparece quando a org tem 2+ números. A IA on/off é o ToggleCaio (separado).
 *
 * Escolher uma persona FIXA a troca (o inbound do cliente não reverte mais);
 * "Automático" solta a fixação e o lead volta a seguir o número que receber.
 */
export function AtendenteSelector({
  leadId,
  atual,
  opcoes,
  fixado = false,
}: {
  leadId: string;
  atual: string | null;
  opcoes: { instance_name: string; persona_nome: string | null }[];
  fixado?: boolean;
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
          title={
            fixado
              ? "Atendente fixado manualmente — o inbound do cliente não muda mais"
              : "Seguindo automaticamente o número pelo qual o cliente escreve"
          }
          className="text-sm font-heading font-medium text-preto bg-white border border-cinza-claro rounded-lg px-2 py-1 focus:outline-none focus:border-laranja transition disabled:opacity-50"
        >
          {!atual && <option value="">— selecione —</option>}
          {opcoes.map((o) => (
            <option key={o.instance_name} value={o.instance_name}>
              {(o.persona_nome ?? o.instance_name) +
                (fixado && o.instance_name === atual ? " 📌" : "")}
            </option>
          ))}
          {fixado && <option value="auto">🔓 Voltar pro automático</option>}
        </select>
      </div>
      {erro && <span className="text-xs text-red-500">{erro}</span>}
    </div>
  );
}
