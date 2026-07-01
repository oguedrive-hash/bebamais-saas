"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewSlotsLivres,
  salvarAgendaConfig,
} from "@/app/dashboard/agenda/actions";
import type {
  AgendaConfig,
  ModoAgenda,
  SlotHorario,
} from "@/lib/caio/agenda-config";

const DIAS_SEMANA = [
  { num: 1, label: "Seg" },
  { num: 2, label: "Ter" },
  { num: 3, label: "Qua" },
  { num: 4, label: "Qui" },
  { num: 5, label: "Sex" },
  { num: 6, label: "Sáb" },
  { num: 7, label: "Dom" },
];

export function AgendaConfigForm({
  configInicial,
}: {
  configInicial: AgendaConfig;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modo, setModo] = useState<ModoAgenda>(configInicial.modo);
  const [dias, setDias] = useState<number[]>(configInicial.dias_semana);
  const [slots, setSlots] = useState<SlotHorario[]>(configInicial.slots);
  const [duracoes, setDuracoes] = useState<number[]>(configInicial.duracoes);
  const [novaDuracao, setNovaDuracao] = useState("");
  const [duracaoPadrao, setDuracaoPadrao] = useState(
    configInicial.duracao_padrao,
  );
  const [antecedencia, setAntecedencia] = useState(
    configInicial.antecedencia_minima_horas,
  );
  const [horizonte, setHorizonte] = useState(configInicial.horizonte_dias);
  const [qtdOpcoes, setQtdOpcoes] = useState(configInicial.qtd_opcoes_propor);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [previewSlots, setPreviewSlots] = useState<
    { inicio: string; fim: string; label: string }[] | null
  >(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);

  async function verPreview() {
    setErro(null);
    setCarregandoPreview(true);
    const result = await previewSlotsLivres();
    setCarregandoPreview(false);
    if ("error" in result) {
      setErro(result.error);
      setPreviewSlots(null);
      return;
    }
    setPreviewSlots(result.slots);
  }

  function toggleDia(num: number) {
    setDias((d) =>
      d.includes(num) ? d.filter((x) => x !== num) : [...d, num].sort(),
    );
    setSucesso(false);
  }

  function adicionarSlot() {
    const ultimoFim = slots.length > 0 ? slots[slots.length - 1].fim : "08:00";
    const novoInicio = ultimoFim;
    const [h, m] = novoInicio.split(":").map(Number);
    const totalMin = h * 60 + m + 60;
    const fimH = Math.min(23, Math.floor(totalMin / 60));
    const fimM = totalMin % 60;
    const novoFim = `${String(fimH).padStart(2, "0")}:${String(fimM).padStart(2, "0")}`;
    setSlots((s) => [...s, { inicio: novoInicio, fim: novoFim }]);
    setSucesso(false);
  }

  function atualizarSlot(idx: number, campo: "inicio" | "fim", valor: string) {
    setSlots((s) =>
      s.map((slot, i) => (i === idx ? { ...slot, [campo]: valor } : slot)),
    );
    setSucesso(false);
  }

  function removerSlot(idx: number) {
    setSlots((s) => s.filter((_, i) => i !== idx));
    setSucesso(false);
  }

  function adicionarDuracao() {
    const n = Number(novaDuracao);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 5 || n > 480) {
      setErro("Duração precisa ser número inteiro entre 5 e 480 minutos");
      return;
    }
    if (duracoes.includes(n)) {
      setErro(`Duração ${n} min já existe`);
      return;
    }
    setDuracoes((d) => [...d, n].sort((a, b) => a - b));
    setNovaDuracao("");
    setErro(null);
    setSucesso(false);
  }

  function removerDuracao(min: number) {
    const novaLista = duracoes.filter((x) => x !== min);
    setDuracoes(novaLista);
    if (min === duracaoPadrao && novaLista.length > 0) {
      setDuracaoPadrao(novaLista[0]);
    }
    setSucesso(false);
  }

  function salvar() {
    setErro(null);
    setSucesso(false);
    startTransition(async () => {
      const result = await salvarAgendaConfig({
        modo,
        dias_semana: dias,
        slots,
        duracoes,
        duracao_padrao: duracaoPadrao,
        antecedencia_minima_horas: antecedencia,
        horizonte_dias: horizonte,
        qtd_opcoes_propor: qtdOpcoes,
      });
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      setSucesso(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Modo de agendamento */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <h2 className="text-base font-heading font-bold text-preto mb-1">
          Modo de agendamento
        </h2>
        <p className="text-xs text-cinza-medio mb-4">
          Escolhe como o Caio (e o painel) interpretam os horários abaixo. Os
          dois modos usam a mesma lista de horários, mas com lógica diferente.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              setModo("slot");
              setSucesso(false);
            }}
            disabled={pending}
            className={`text-left p-4 rounded-xl border-2 transition disabled:opacity-50 ${
              modo === "slot"
                ? "border-laranja bg-laranja/5"
                : "border-cinza-claro hover:border-preto"
            }`}
          >
            <p className="font-heading font-bold text-preto mb-1">
              📅 Slot fixo
            </p>
            <p className="text-xs text-cinza-medio">
              Cada horário abaixo vira uma janela de retirada inteira (ex:
              8h-10h30). Caio só oferece esses blocos.
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              setModo("duracao");
              setSucesso(false);
            }}
            disabled={pending}
            className={`text-left p-4 rounded-xl border-2 transition disabled:opacity-50 ${
              modo === "duracao"
                ? "border-laranja bg-laranja/5"
                : "border-cinza-claro hover:border-preto"
            }`}
          >
            <p className="font-heading font-bold text-preto mb-1">
              ⏱️ Por duração
            </p>
            <p className="text-xs text-cinza-medio">
              Os horários abaixo viram janelas de atendimento (ex: 8h-12h =
              manhã). Caio aloca dentro com a duração padrão.
            </p>
          </button>
        </div>
      </section>

      {/* Dias da semana */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <h2 className="text-base font-heading font-bold text-preto mb-1">
          Dias da semana
        </h2>
        <p className="text-xs text-cinza-medio mb-4">
          Dias em que a loja funciona e o cliente pode retirar o pedido.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {DIAS_SEMANA.map((d) => {
            const ativo = dias.includes(d.num);
            return (
              <button
                key={d.num}
                type="button"
                onClick={() => toggleDia(d.num)}
                disabled={pending}
                className={`px-4 py-2 rounded-lg text-sm font-heading font-semibold transition border ${
                  ativo
                    ? "bg-preto text-white border-preto"
                    : "bg-white text-cinza-medio border-cinza-claro hover:border-preto"
                } disabled:opacity-50`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Slots / janelas */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-heading font-bold text-preto">
            {modo === "slot" ? "Slots de horário" : "Janelas de atendimento"}
          </h2>
          <button
            type="button"
            onClick={adicionarSlot}
            disabled={pending}
            className="text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold disabled:opacity-50"
          >
            + Adicionar
          </button>
        </div>
        <p className="text-xs text-cinza-medio mb-4">
          {modo === "slot"
            ? "Cada bloco vira uma janela de retirada fixa. Pausas entre blocos (ex: almoço de 12h a 13h) são automáticas — só deixar gap."
            : "Cada bloco é uma janela em que o Caio pode alocar retiradas com a duração padrão. Gaps entre janelas são pausas automáticas."}
        </p>

        {slots.length === 0 ? (
          <p className="text-sm text-cinza-medio text-center py-4">
            Nenhum {modo === "slot" ? "slot" : "janela"} configurado.
          </p>
        ) : (
          <div className="space-y-2">
            {slots.map((slot, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 p-3 border border-cinza-claro rounded-lg"
              >
                <input
                  type="time"
                  value={slot.inicio}
                  onChange={(e) => atualizarSlot(idx, "inicio", e.target.value)}
                  disabled={pending}
                  className="px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition disabled:opacity-50"
                />
                <span className="text-cinza-medio">até</span>
                <input
                  type="time"
                  value={slot.fim}
                  onChange={(e) => atualizarSlot(idx, "fim", e.target.value)}
                  disabled={pending}
                  className="px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition disabled:opacity-50"
                />
                <span className="text-xs text-cinza-medio ml-auto">
                  {duracaoSlot(slot)}
                </span>
                <button
                  type="button"
                  onClick={() => removerSlot(idx)}
                  disabled={pending}
                  className="text-xs text-red-600 hover:text-red-700 font-heading font-semibold disabled:opacity-50"
                >
                  remover
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Durações */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <h2 className="text-base font-heading font-bold text-preto mb-1">
          Durações disponíveis
        </h2>
        <p className="text-xs text-cinza-medio mb-4">
          Aparecem como botões no form &ldquo;Novo agendamento&rdquo;.
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {duracoes.length === 0 ? (
            <p className="text-sm text-cinza-medio">Nenhuma duração configurada.</p>
          ) : (
            duracoes.map((d) => (
              <span
                key={d}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-heading font-semibold ${
                  d === duracaoPadrao
                    ? "bg-laranja/10 text-laranja-escuro border-laranja"
                    : "bg-offwhite text-preto border-cinza-claro"
                }`}
              >
                {d} min
                {d === duracaoPadrao && (
                  <span className="text-[10px] uppercase tracking-wider">padrão</span>
                )}
                <button
                  type="button"
                  onClick={() => removerDuracao(d)}
                  disabled={pending}
                  className="text-cinza-medio hover:text-red-600 disabled:opacity-40"
                  aria-label={`Remover ${d} min`}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 mb-4">
          <input
            type="number"
            min={5}
            max={480}
            value={novaDuracao}
            onChange={(e) => setNovaDuracao(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                adicionarDuracao();
              }
            }}
            placeholder="ex: 60"
            disabled={pending}
            className="w-28 px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition disabled:opacity-50"
          />
          <button
            type="button"
            onClick={adicionarDuracao}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg border border-cinza-claro text-xs font-heading font-semibold text-cinza-medio hover:text-preto hover:border-preto disabled:opacity-50 transition"
          >
            Adicionar
          </button>
          <span className="text-xs text-cinza-medio ml-1">5 a 480 min</span>
        </div>

        {modo === "duracao" && duracoes.length > 0 && (
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
              Duração padrão (Caio usa por default)
            </label>
            <select
              value={duracaoPadrao}
              onChange={(e) => {
                setDuracaoPadrao(Number(e.target.value));
                setSucesso(false);
              }}
              disabled={pending}
              className="px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition disabled:opacity-50"
            >
              {duracoes.map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Regras de agendamento do Caio */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <h2 className="text-base font-heading font-bold text-preto mb-1">
          Regras de agendamento
        </h2>
        <p className="text-xs text-cinza-medio mb-4">
          Quando o Caio for propor horários pro lead, segue essas regras.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
              Antecedência mínima (horas)
            </label>
            <input
              type="number"
              min={0}
              max={168}
              step={0.5}
              value={antecedencia}
              onChange={(e) => {
                setAntecedencia(Number(e.target.value));
                setSucesso(false);
              }}
              disabled={pending}
              className="w-32 px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition disabled:opacity-50"
            />
            <p className="text-[10px] text-cinza-medio mt-1">
              Não agendar nas próximas N horas a partir de agora.
            </p>
          </div>

          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
              Horizonte máximo (dias)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={horizonte}
              onChange={(e) => {
                setHorizonte(Number(e.target.value));
                setSucesso(false);
              }}
              disabled={pending}
              className="w-32 px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition disabled:opacity-50"
            />
            <p className="text-[10px] text-cinza-medio mt-1">
              Só agendar nos próximos N dias a partir de agora.
            </p>
          </div>

          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
              Opções a propor por vez
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={qtdOpcoes}
              onChange={(e) => {
                setQtdOpcoes(Number(e.target.value));
                setSucesso(false);
              }}
              disabled={pending}
              className="w-32 px-3 py-1.5 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition disabled:opacity-50"
            />
            <p className="text-[10px] text-cinza-medio mt-1">
              Quantos horários o Caio oferece em uma mensagem.
            </p>
          </div>
        </div>
      </section>

      {/* Preview de slots livres */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-heading font-bold text-preto">
            Próximos slots livres
          </h2>
          <button
            type="button"
            onClick={verPreview}
            disabled={pending || carregandoPreview}
            className="text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold disabled:opacity-50"
          >
            {carregandoPreview ? "Calculando..." : "Atualizar"}
          </button>
        </div>
        <p className="text-xs text-cinza-medio mb-4">
          O que o Caio proporia ao lead AGORA com a config atual (lê a config
          salva no banco — clica em &ldquo;Salvar&rdquo; antes pra ver mudanças
          recém-editadas).
        </p>
        {previewSlots === null ? (
          <p className="text-sm text-cinza-medio text-center py-4">
            Clica em &ldquo;Atualizar&rdquo; pra calcular.
          </p>
        ) : previewSlots.length === 0 ? (
          <p className="text-sm text-cinza-medio text-center py-4">
            Sem slots livres no horizonte configurado.
          </p>
        ) : (
          <ul className="space-y-1">
            {previewSlots.map((s, i) => (
              <li
                key={i}
                className="px-3 py-2 bg-offwhite border border-cinza-claro rounded-lg text-sm text-preto font-mono"
              >
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </section>

      {erro && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}
      {sucesso && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <p className="text-sm text-emerald-800">✓ Configuração salva</p>
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="px-5 py-2.5 bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold rounded-lg disabled:opacity-50 transition"
        >
          {pending ? "Salvando..." : "Salvar configuração"}
        </button>
      </div>
    </div>
  );
}

function duracaoSlot(slot: SlotHorario): string {
  const [hi, mi] = slot.inicio.split(":").map(Number);
  const [hf, mf] = slot.fim.split(":").map(Number);
  const totalMin = hf * 60 + mf - (hi * 60 + mi);
  if (totalMin <= 0) return "inválido";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
