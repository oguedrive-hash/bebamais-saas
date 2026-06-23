"use client";

import { useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { resolverHandoff } from "@/app/dashboard/leads/[id]/actions";

/**
 * Botão "Finalizar" pra dispensar a notificação de handoff do sino.
 * Limpa precisa_humano_* do lead (via resolverHandoff). Para o e.preventDefault
 * pra não navegar pro contato (o item do sino é um link).
 */
export function BotaoFinalizarHandoff({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function finalizar(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const form = new FormData();
    form.set("leadId", leadId);
    startTransition(async () => {
      await resolverHandoff(form);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={finalizar}
      disabled={pending}
      title="Finalizar — já cuidei desse lead"
      className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-cinza-claro text-cinza-medio hover:bg-green-50 hover:text-green-700 hover:border-green-300 font-heading font-semibold transition disabled:opacity-50"
    >
      {pending ? "..." : "✓ Finalizar"}
    </button>
  );
}
