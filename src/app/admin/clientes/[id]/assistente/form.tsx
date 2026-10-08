"use client";

import { useState, useTransition } from "react";
import { DIAS, NOME_DIA, type AtendimentoConfig, type DiaSemana } from "@/lib/atendimento/regras";
import { salvarAssistente } from "./actions";

const EXEMPLO = `Endereço: Rua ..., nº ..., bairro, Americana/SP
Formas de pagamento: pix, dinheiro, cartão de débito e crédito
Entrega: entregamos em Americana e região, com frota própria
Retirada: o cliente pode retirar na loja
O que vendemos: cervejas, destilados, refrigerantes, sucos, energéticos, água, gelo e carvão
Também alugamos: caixas térmicas, mesas e cadeiras para festas`;

export function FormAssistente(props: {
  orgId: string;
  informacoesIniciais: string;
  configInicial: AtendimentoConfig;
  respostasIniciais: string[];
}) {
  const [informacoes, setInformacoes] = useState(props.informacoesIniciais);
  const [config, setConfig] = useState(props.configInicial);
  const [respostas, setRespostas] = useState(props.respostasIniciais.join("\n"));
  const [novaData, setNovaData] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  function setDia(d: DiaSemana, valor: { abre: string; fecha: string } | null) {
    setConfig({ ...config, horarios: { ...config.horarios, [d]: valor } });
  }

  function salvar() {
    setMsg(null);
    iniciar(async () => {
      const r = await salvarAssistente(props.orgId, {
        informacoes,
        config,
        respostasRapidas: respostas.split("\n"),
      });
      setMsg("error" in r ? { tipo: "erro", texto: r.error } : { tipo: "ok", texto: "Salvo. O assistente já usa as novas informações." });
    });
  }

  const secao = "rounded-2xl border border-cinza-claro bg-white p-5 space-y-3";
  return (
    <div className="space-y-6">
      <label className={`${secao} flex items-center gap-3 cursor-pointer`}>
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={config.assistente_ativo}
          onChange={(e) => setConfig({ ...config, assistente_ativo: e.target.checked })}
        />
        <span>
          <span className="font-heading font-semibold">Assistente ligado</span>
          <span className="block text-sm text-cinza-medio">Desligado: todas as mensagens vão direto para a fila das atendentes.</span>
        </span>
      </label>

      <div className={secao}>
        <p className="font-heading font-semibold">Cidade da loja</p>
        <p className="text-sm text-cinza-medio">
          O assistente sempre pode dizer isso. Se perguntarem algo fora do normal (entrega em outro estado, produto que não
          tem nada a ver), ele responde &quot;Estamos localizados em {config.cidade || "..."}&quot; e passa para a atendente.
        </p>
        <input
          value={config.cidade}
          onChange={(e) => setConfig({ ...config, cidade: e.target.value })}
          placeholder="Americana/SP"
          className="w-full max-w-sm rounded-lg border border-cinza-claro px-3 py-2 text-sm"
        />
      </div>

      <div className={secao}>
        <p className="font-heading font-semibold">Informações da loja</p>
        <p className="text-sm text-cinza-medio">
          É só isso que o assistente sabe. Escreva como se explicasse para uma atendente nova. Ele usa para responder
          dúvidas simples; o que não estiver aqui, ele passa para a atendente.
        </p>
        <textarea
          value={informacoes}
          onChange={(e) => setInformacoes(e.target.value)}
          rows={9}
          placeholder={EXEMPLO}
          className="w-full rounded-lg border border-cinza-claro px-3 py-2 text-sm"
        />
      </div>

      <div className={secao}>
        <p className="font-heading font-semibold">Horário de atendimento</p>
        <p className="text-sm text-cinza-medio">Fora desse horário o assistente avisa quando a loja abre.</p>
        <div className="space-y-2">
          {DIAS.map((d) => {
            const h = config.horarios[d];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3">
                <label className="w-40 flex items-center gap-2">
                  <input type="checkbox" checked={!!h} onChange={(e) => setDia(d, e.target.checked ? { abre: "08:00", fecha: "18:00" } : null)} />
                  <span className="capitalize">{NOME_DIA[d]}</span>
                </label>
                {h ? (
                  <>
                    <input type="time" value={h.abre} onChange={(e) => setDia(d, { ...h, abre: e.target.value })} className="rounded border border-cinza-claro px-2 py-1" />
                    <span>às</span>
                    <input type="time" value={h.fecha} onChange={(e) => setDia(d, { ...h, fecha: e.target.value })} className="rounded border border-cinza-claro px-2 py-1" />
                  </>
                ) : (
                  <span className="text-sm text-cinza-medio">Fechado</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={secao}>
        <p className="font-heading font-semibold">Feriados e dias fechados</p>
        <p className="text-sm text-cinza-medio">
          Nesses dias o assistente avisa que a loja está fechada e quando volta a abrir. Cadastre antes de cada feriado
          em que a loja não abre.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} className="rounded border border-cinza-claro px-2 py-1" />
          <button
            type="button"
            disabled={!novaData}
            onClick={() => {
              setConfig({ ...config, dias_fechados: [...new Set([...config.dias_fechados, novaData])].sort() });
              setNovaData("");
            }}
            className="rounded-lg border border-cinza-claro px-3 py-1 text-sm disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
        {config.dias_fechados.length ? (
          <ul className="flex flex-wrap gap-2">
            {config.dias_fechados.map((d) => (
              <li key={d} className="flex items-center gap-2 rounded-full bg-cinza-claro/50 px-3 py-1 text-sm">
                {d.slice(8, 10)}/{d.slice(5, 7)}/{d.slice(0, 4)}
                <button
                  type="button"
                  aria-label="Remover"
                  onClick={() => setConfig({ ...config, dias_fechados: config.dias_fechados.filter((x) => x !== d) })}
                  className="text-cinza-medio hover:text-vermelho"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-cinza-medio">Nenhum dia cadastrado.</p>
        )}
      </div>

      <div className={secao}>
        <p className="font-heading font-semibold">Tempo de espera</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Se ninguém pegar o cliente, mandar mensagem de espera depois de</span>
          <input
            type="number"
            min={1}
            value={config.espera_minutos[0] ?? 5}
            onChange={(e) => setConfig({ ...config, espera_minutos: [Number(e.target.value), config.espera_minutos[1] ?? 15] })}
            className="w-16 rounded border border-cinza-claro px-2 py-1"
          />
          <span>e</span>
          <input
            type="number"
            min={1}
            value={config.espera_minutos[1] ?? 15}
            onChange={(e) => setConfig({ ...config, espera_minutos: [config.espera_minutos[0] ?? 5, Number(e.target.value)] })}
            className="w-16 rounded border border-cinza-claro px-2 py-1"
          />
          <span>minutos.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Conversa parada há mais de</span>
          <input
            type="number"
            min={1}
            value={config.reiniciar_apos_horas}
            onChange={(e) => setConfig({ ...config, reiniciar_apos_horas: Number(e.target.value) })}
            className="w-16 rounded border border-cinza-claro px-2 py-1"
          />
          <span>horas volta para o assistente na próxima mensagem do cliente.</span>
        </div>
      </div>

      <div className={secao}>
        <p className="font-heading font-semibold">Respostas prontas do painel</p>
        <p className="text-sm text-cinza-medio">Uma por linha (até 12). Aparecem como botões para as atendentes.</p>
        <textarea value={respostas} onChange={(e) => setRespostas(e.target.value)} rows={7} className="w-full rounded-lg border border-cinza-claro px-3 py-2 text-sm" />
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${msg.tipo === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
          {msg.texto}
        </div>
      )}
      <button onClick={salvar} disabled={pendente} className="rounded-lg bg-vermelho text-white px-6 py-3 font-heading font-bold disabled:opacity-50">
        {pendente ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}
