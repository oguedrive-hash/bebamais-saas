"use client";

import Link from "next/link";
import { setAgendaView } from "@/app/dashboard/agenda/actions";

/**
 * Toggle Lista/Calendário da tela Retiradas. Além de navegar (?view=),
 * persiste a preferência no cookie via setAgendaView — sem isso o usuário
 * voltava sempre pra Lista ao navegar pelo menu (a action existia mas
 * ninguém a chamava).
 */
export function AgendaViewToggle({
  viewAtual,
}: {
  viewAtual: "lista" | "calendario";
}) {
  function persistir(view: "lista" | "calendario") {
    // Best-effort — a navegação do Link acontece de qualquer forma
    void setAgendaView(view);
  }
  return (
    <div className="inline-flex rounded-lg border border-cinza-claro overflow-hidden">
      <Link
        href="/dashboard/agenda?view=lista"
        onClick={() => persistir("lista")}
        className={`px-3 py-2 text-sm font-heading font-semibold transition border-r border-cinza-claro flex items-center gap-1.5 ${
          viewAtual === "lista"
            ? "bg-preto text-white"
            : "bg-white text-cinza-medio hover:text-preto"
        }`}
      >
        Lista
      </Link>
      <Link
        href="/dashboard/agenda?view=calendario"
        onClick={() => persistir("calendario")}
        className={`px-3 py-2 text-sm font-heading font-semibold transition flex items-center gap-1.5 ${
          viewAtual === "calendario"
            ? "bg-preto text-white"
            : "bg-white text-cinza-medio hover:text-preto"
        }`}
      >
        Calendário
      </Link>
    </div>
  );
}
