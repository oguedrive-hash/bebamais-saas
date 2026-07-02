"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATUS_CONFIG, STATUS_ORDEM, type StatusLead } from "@/lib/status-config";
import { mudarStatusLead } from "@/app/dashboard/leads/[id]/actions";

type Lead = {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  source: string | null;
  caio_ativo: boolean | null;
  created_at: string;
  updated_at: string;
};

export function KanbanDrag({
  leads,
  colunas,
}: {
  leads: Lead[];
  // Lista de colunas a exibir. Default: STATUS_ORDEM (fluxo inbound).
  // Pra prospeccao passar lista incluindo aguardando_primeiro_contato e em_prospeccao.
  colunas?: StatusLead[];
}) {
  const router = useRouter();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<StatusLead | null>(null);
  // optimisticLeads permite mover o card visualmente antes do server responder
  const [optimisticStatus, setOptimisticStatus] = useState<
    Record<string, StatusLead>
  >({});

  const effectiveStatus = (lead: Lead): StatusLead =>
    (optimisticStatus[lead.id] ?? lead.status) as StatusLead;

  const ordens = colunas ?? STATUS_ORDEM;

  const porStatus: Record<StatusLead, Lead[]> = {} as Record<
    StatusLead,
    Lead[]
  >;
  ordens.forEach((s) => {
    porStatus[s] = [];
  });
  leads.forEach((l) => {
    const s = effectiveStatus(l);
    if (porStatus[s]) porStatus[s].push(l);
  });

  function onDragStart(e: DragEvent<HTMLDivElement>, leadId: string) {
    e.dataTransfer.setData("text/plain", leadId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(leadId);
  }

  function onDragEnd() {
    setDraggingId(null);
    setDropTarget(null);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>, status: StatusLead) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== status) setDropTarget(status);
  }

  async function onDrop(e: DragEvent<HTMLDivElement>, status: StatusLead) {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("text/plain");
    setDraggingId(null);
    setDropTarget(null);
    if (!leadId) return;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || effectiveStatus(lead) === status) return;

    // Optimistic update — move o card na UI imediato
    setOptimisticStatus((prev) => ({ ...prev, [leadId]: status }));

    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("status", status);
    const result = await mudarStatusLead(fd);

    if ("error" in result) {
      // Reverte se falhou
      console.error("[kanban] falha ao mudar status:", result.error);
      setOptimisticStatus((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
    } else {
      // Limpa o optimistic — dado real virá via Realtime/refresh
      router.refresh();
      // Pequeno delay pra Realtime propagar antes de limpar o local
      setTimeout(() => {
        setOptimisticStatus((prev) => {
          const next = { ...prev };
          delete next[leadId];
          return next;
        });
      }, 1500);
    }
  }

  return (
    <div className="grid grid-cols-7 gap-2">
      {ordens.map((status) => {
        const config = STATUS_CONFIG[status];
        const leadsCol = porStatus[status];
        const isTarget = dropTarget === status;
        return (
          <div
            key={status}
            className="min-w-0"
            onDragOver={(e) => onDragOver(e, status)}
            onDrop={(e) => onDrop(e, status)}
          >
            <div className={`h-1 rounded-t-md ${config.barra}`} />
            <div className="flex items-center gap-2 px-2 py-2 bg-white">
              <span
                className={`text-[11px] font-heading font-bold uppercase tracking-wider ${config.cor}`}
              >
                {config.label}
              </span>
              <span className="text-[11px] font-heading font-semibold text-cinza-medio">
                {leadsCol.length}
              </span>
            </div>
            <div
              className={`flex flex-col gap-2 px-2 pb-2 bg-white rounded-b-md overflow-y-auto transition-colors ${
                isTarget ? "bg-laranja/5 outline outline-2 outline-laranja/40" : ""
              }`}
              style={{ minHeight: "calc(100vh - 280px)" }}
            >
              {leadsCol.length === 0 ? (
                <p className="text-xs text-cinza-medio text-center py-6">
                  {isTarget ? "Solta aqui" : "Vazio"}
                </p>
              ) : (
                leadsCol.map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, lead.id)}
                    onDragEnd={onDragEnd}
                    className={`group transition ${
                      draggingId === lead.id
                        ? "opacity-40 scale-95"
                        : "opacity-100"
                    }`}
                  >
                    <Link
                      href={`/dashboard/contatos/${lead.id}`}
                      draggable={false}
                      onClick={(e) => {
                        // Se ainda tava arrastando, ignora click
                        if (draggingId === lead.id) e.preventDefault();
                      }}
                      className="block p-3 bg-white rounded-md border border-cinza-claro hover:border-laranja hover:shadow-sm transition cursor-grab active:cursor-grabbing"
                    >
                      <p className="text-sm font-heading font-semibold text-preto truncate">
                        {lead.nome ?? "Sem nome"}
                      </p>
                      <p className="text-xs text-cinza-medio font-mono mt-0.5">
                        {lead.telefone}
                      </p>
                      <div className="flex items-center justify-between mt-2 gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-heading font-semibold ${
                            lead.caio_ativo ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              lead.caio_ativo ? "bg-green-500" : "bg-red-500"
                            }`}
                          />
                          {lead.caio_ativo ? "IA on" : "IA off"}
                        </span>
                        <span className="text-[10px] text-cinza-medio">
                          {formatRelativeDate(lead.updated_at)}
                        </span>
                      </div>
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
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
