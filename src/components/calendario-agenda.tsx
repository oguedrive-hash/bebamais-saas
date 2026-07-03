"use client";

import { useState } from "react";
import Link from "next/link";

type Agendamento = {
  id: string;
  data_inicio: string;
  status: string;
  lead_id: string;
  lead_nome: string | null;
  lead_telefone: string;
};

const STATUS_COR: Record<string, string> = {
  sugerido: "bg-amber-500",
  agendado: "bg-emerald-500",
  realizado: "bg-blue-500",
  no_show: "bg-red-500",
  cancelado: "bg-cinza-medio",
};

const MESES_BR = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function CalendarioAgenda({
  agendamentos,
}: {
  agendamentos: Agendamento[];
}) {
  const hoje = new Date();
  const [cursor, setCursor] = useState(
    new Date(hoje.getFullYear(), hoje.getMonth(), 1),
  );

  const ano = cursor.getFullYear();
  const mes = cursor.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const diasNoMes = ultimoDia.getDate();
  const offsetInicial = primeiroDia.getDay(); // 0 = domingo

  // Agrupa agendamentos por dia do mês
  const porDia: Record<number, Agendamento[]> = {};
  agendamentos.forEach((a) => {
    const d = new Date(a.data_inicio);
    if (d.getFullYear() === ano && d.getMonth() === mes) {
      const dia = d.getDate();
      if (!porDia[dia]) porDia[dia] = [];
      porDia[dia].push(a);
    }
  });

  const celulas: ({ dia: number } | null)[] = [];
  for (let i = 0; i < offsetInicial; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push({ dia: d });
  while (celulas.length % 7 !== 0) celulas.push(null);

  function mudarMes(delta: number) {
    setCursor(new Date(ano, mes + delta, 1));
  }

  function irHoje() {
    setCursor(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  }

  const ehMesAtual =
    cursor.getFullYear() === hoje.getFullYear() &&
    cursor.getMonth() === hoje.getMonth();

  return (
    <div className="bg-white rounded-2xl border border-cinza-claro overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4 border-b border-cinza-claro">
        <h2 className="text-lg font-heading font-bold text-preto capitalize">
          {MESES_BR[mes]} {ano}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => mudarMes(-1)}
            className="p-1.5 rounded-lg text-cinza-medio hover:bg-offwhite hover:text-preto transition"
            title="Mês anterior"
          >
            ‹
          </button>
          {!ehMesAtual && (
            <button
              type="button"
              onClick={irHoje}
              className="px-3 py-1.5 rounded-lg text-xs text-preto hover:bg-offwhite transition font-heading font-semibold"
            >
              Hoje
            </button>
          )}
          <button
            type="button"
            onClick={() => mudarMes(1)}
            className="p-1.5 rounded-lg text-cinza-medio hover:bg-offwhite hover:text-preto transition"
            title="Mês seguinte"
          >
            ›
          </button>
        </div>
      </div>

      {/* Dias da semana */}
      <div className="grid grid-cols-7 border-b border-cinza-claro bg-offwhite">
        {DIAS_SEMANA.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Grid de dias */}
      <div className="grid grid-cols-7">
        {celulas.map((cell, i) => {
          if (!cell) {
            return (
              <div
                key={`empty-${i}`}
                className="aspect-square border-b border-r border-cinza-claro bg-offwhite/50"
              />
            );
          }
          const dia = cell.dia;
          const ehHoje =
            ehMesAtual && dia === hoje.getDate();
          const lista = porDia[dia] ?? [];
          return (
            <div
              key={dia}
              className={`min-h-[100px] border-b border-r border-cinza-claro p-1.5 ${
                ehHoje ? "bg-laranja/5" : "bg-white"
              }`}
            >
              <div
                className={`text-xs font-heading font-semibold mb-1 ${
                  ehHoje
                    ? "inline-flex items-center justify-center w-6 h-6 rounded-full bg-laranja text-white"
                    : "text-cinza-medio"
                }`}
              >
                {dia}
              </div>
              <div className="space-y-1">
                {lista.slice(0, 3).map((a) => (
                  <CardMini key={a.id} agendamento={a} />
                ))}
                {lista.length > 3 && (
                  <p className="text-[10px] text-cinza-medio pl-1">
                    +{lista.length - 3}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardMini({ agendamento }: { agendamento: Agendamento }) {
  const d = new Date(agendamento.data_inicio);
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const cor = STATUS_COR[agendamento.status] ?? "bg-cinza-medio";
  return (
    <Link
      href={`/dashboard/contatos/${agendamento.lead_id}`}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-offwhite transition"
      title={`${hora} — ${agendamento.lead_nome ?? agendamento.lead_telefone}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cor}`} />
      <span className="text-[10px] font-mono text-cinza-medio flex-shrink-0">
        {hora}
      </span>
      <span className="text-[10px] text-preto truncate">
        {agendamento.lead_nome ?? "Lead"}
      </span>
    </Link>
  );
}
