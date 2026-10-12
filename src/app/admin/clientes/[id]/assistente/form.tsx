"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { DIAS, NOME_DIA, agoraSaoPaulo, feriadosNacionais, type AtendimentoConfig, type DiaSemana } from "@/lib/atendimento/regras";
import { salvarAssistente } from "./actions";

const EXEMPLO = `QUEM SOMOS
- Somos a Loja X, distribuidora de bebidas em Americana/SP.
- Trabalhamos com água, refrigerante, cerveja, carvão e gelo.

ENDEREÇO
- Rua ..., nº ..., bairro, Americana/SP.

ENTREGA
- Entregamos em todos os bairros de Americana. Outras cidades: a atendente confirma.

PAGAMENTO
- Aceitamos Pix, dinheiro e cartão.`;

function dataBR(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function Secao(props: { numero: number; titulo: string; ajuda: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-cinza-claro bg-white p-5 space-y-3">
      <div>
        <h2 className="font-heading font-bold text-lg text-preto">
          {props.numero}. {props.titulo}
        </h2>
        <p className="text-sm text-cinza-medio mt-0.5">{props.ajuda}</p>
      </div>
      {props.children}
    </section>
  );
}

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
  // O que está salvo no banco: base para saber se há alteração pendente.
  const [salvo, setSalvo] = useState(() => JSON.stringify([props.informacoesIniciais, props.configInicial, props.respostasIniciais.join("\n")]));
  const alterado = JSON.stringify([informacoes, config, respostas]) !== salvo;

  // Avisa antes de fechar ou recarregar a página com alteração não salva.
  useEffect(() => {
    if (!alterado) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [alterado]);

  const hoje = useMemo(() => agoraSaoPaulo(new Date()).data, []);
  const nacionais = useMemo(() => feriadosNacionais(hoje), [hoje]);
  const nomeFeriado = (d: string) => nacionais.find((f) => f.data === d)?.nome;
  const faltamNacionais = nacionais.filter((f) => !config.dias_fechados.includes(f.data));

  function setDia(d: DiaSemana, valor: { abre: string; fecha: string } | null) {
    setConfig({ ...config, horarios: { ...config.horarios, [d]: valor } });
  }

  function adicionarDatas(datas: string[]) {
    setConfig({ ...config, dias_fechados: [...new Set([...config.dias_fechados, ...datas])].sort() });
  }

  function salvar() {
    setMsg(null);
    iniciar(async () => {
      const r = await salvarAssistente(props.orgId, {
        informacoes,
        config,
        respostasRapidas: respostas.split("\n"),
      });
      if ("error" in r) setMsg({ tipo: "erro", texto: r.error });
      else {
        setSalvo(JSON.stringify([informacoes, config, respostas]));
        setMsg({ tipo: "ok", texto: "Salvo! O assistente já está usando as novas informações." });
      }
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <div
        className={`rounded-2xl border-2 p-5 flex flex-wrap items-center justify-between gap-4 ${
          config.assistente_ativo ? "border-green-300 bg-green-50" : "border-stone-300 bg-stone-100"
        }`}
      >
        <div>
          <p className={`font-heading font-bold text-lg ${config.assistente_ativo ? "text-green-900" : "text-stone-800"}`}>
            O assistente está {config.assistente_ativo ? "LIGADO" : "DESLIGADO"}
          </p>
          <p className="text-sm text-cinza-medio">
            {config.assistente_ativo
              ? "Ele responde primeiro nos números em que estiver permitido (veja em Números de WhatsApp)."
              : "Nenhum número tem assistente: todas as mensagens vão direto para a fila das atendentes."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfig({ ...config, assistente_ativo: !config.assistente_ativo })}
          className="rounded-lg border border-cinza-claro bg-white px-4 py-2 font-heading font-semibold"
        >
          {config.assistente_ativo ? "Desligar o assistente" : "Ligar o assistente"}
        </button>
      </div>

      <Secao
        numero={1}
        titulo="Informações da loja"
        ajuda="É tudo o que o assistente sabe sobre a loja. Ele usa para tirar dúvidas simples; o que não estiver escrito aqui, ele passa para uma atendente."
      >
        <ul className="text-sm text-cinza-medio list-disc pl-5 space-y-0.5">
          <li>Escreva como se explicasse para uma atendente nova: um assunto por bloco, frases curtas.</li>
          <li>Diga também o que a loja NÃO faz (ex.: “Não temos mesas nem cadeiras”).</li>
          <li>Não coloque preços, promoções nem estoque: isso a atendente sempre confirma.</li>
        </ul>
        <textarea
          value={informacoes}
          onChange={(e) => setInformacoes(e.target.value)}
          rows={14}
          placeholder={EXEMPLO}
          className="w-full rounded-lg border border-cinza-claro px-3 py-2 text-sm font-mono focus:outline-none focus:border-vermelho"
        />
      </Secao>

      <Secao numero={2} titulo="Cidade da loja" ajuda="O assistente usa para dizer onde a loja fica, por exemplo quando alguém de muito longe pergunta se entregamos.">
        <input
          value={config.cidade}
          onChange={(e) => setConfig({ ...config, cidade: e.target.value })}
          placeholder="Americana/SP"
          className="w-full max-w-sm rounded-lg border border-cinza-claro px-3 py-2 text-sm focus:outline-none focus:border-vermelho"
        />
      </Secao>

      <Secao
        numero={3}
        titulo="Horário de atendimento"
        ajuda="Marque os dias em que a loja abre. Fora desse horário, o assistente avisa o cliente quando a loja abre e deixa a conversa na fila para as atendentes."
      >
        <div className="space-y-2">
          {DIAS.map((d) => {
            const h = config.horarios[d];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3">
                <label className="w-44 flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!h} onChange={(e) => setDia(d, e.target.checked ? { abre: "08:00", fecha: "18:00" } : null)} className="h-4 w-4" />
                  <span className="capitalize">{NOME_DIA[d]}</span>
                </label>
                {h ? (
                  <>
                    <span className="text-sm text-cinza-medio">abre</span>
                    <input type="time" value={h.abre} onChange={(e) => setDia(d, { ...h, abre: e.target.value })} className="rounded border border-cinza-claro px-2 py-1" />
                    <span className="text-sm text-cinza-medio">fecha</span>
                    <input type="time" value={h.fecha} onChange={(e) => setDia(d, { ...h, fecha: e.target.value })} className="rounded border border-cinza-claro px-2 py-1" />
                  </>
                ) : (
                  <span className="text-sm text-cinza-medio">Fechado</span>
                )}
              </div>
            );
          })}
        </div>
      </Secao>

      <Secao
        numero={4}
        titulo="Feriados e dias fechados"
        ajuda="Nesses dias o assistente avisa que a loja está fechada e quando volta a abrir. Feriados que já passaram saem da lista sozinhos."
      >
        {faltamNacionais.length > 0 && (
          <div className="rounded-lg bg-offwhite px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3">
            <span>
              {faltamNacionais.length > 1
                ? `Faltam ${faltamNacionais.length} feriados nacionais dos próximos 12 meses.`
                : "Falta 1 feriado nacional dos próximos 12 meses."}
            </span>
            <button
              type="button"
              onClick={() => adicionarDatas(faltamNacionais.map((f) => f.data))}
              className="rounded-lg bg-preto text-white px-3 py-1.5 font-semibold"
            >
              Adicionar feriados nacionais
            </button>
          </div>
        )}
        <p className="text-xs text-cinza-medio">
          Depois de adicionar, tire da lista (no ✕) os feriados em que a loja abre. Feriados de Americana, Carnaval e Corpus
          Christi não entram automaticamente: adicione abaixo se a loja fechar.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} className="rounded border border-cinza-claro px-2 py-1" />
          <button
            type="button"
            disabled={!novaData}
            onClick={() => {
              adicionarDatas([novaData]);
              setNovaData("");
            }}
            className="rounded-lg border border-cinza-claro px-3 py-1 text-sm disabled:opacity-50"
          >
            Adicionar este dia
          </button>
        </div>
        {config.dias_fechados.length ? (
          <ul className="flex flex-wrap gap-2">
            {config.dias_fechados.map((d) => (
              <li key={d} className="flex items-center gap-2 rounded-full bg-cinza-claro/60 px-3 py-1 text-sm">
                {dataBR(d)}
                {nomeFeriado(d) && <span className="text-cinza-medio">· {nomeFeriado(d)}</span>}
                <button
                  type="button"
                  aria-label={`Tirar ${dataBR(d)} da lista`}
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
      </Secao>

      <Secao
        numero={5}
        titulo="Quando o cliente está esperando"
        ajuda="Se nenhuma atendente pegar o cliente, o assistente manda uma mensagem pedindo um instante (no máximo duas vezes, só com a loja aberta)."
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Primeira mensagem (“Só um instante...”) depois de</span>
          <input
            type="number"
            min={1}
            value={config.espera_minutos[0] ?? 5}
            onChange={(e) => setConfig({ ...config, espera_minutos: [Number(e.target.value), config.espera_minutos[1] ?? 15] })}
            className="w-16 rounded border border-cinza-claro px-2 py-1"
          />
          <span>minutos.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Segunda mensagem (“Desculpe a demora...”) depois de</span>
          <input
            type="number"
            min={1}
            value={config.espera_minutos[1] ?? 15}
            onChange={(e) => setConfig({ ...config, espera_minutos: [config.espera_minutos[0] ?? 5, Number(e.target.value)] })}
            className="w-16 rounded border border-cinza-claro px-2 py-1"
          />
          <span>minutos.</span>
        </div>
      </Secao>

      <Secao
        numero={6}
        titulo="Quando o assistente volta a atender"
        ajuda="Depois que uma conversa termina, o cliente que escrever de novo é atendido primeiro pelo assistente, como uma conversa nova."
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Se a conversa ficar parada por mais de</span>
          <input
            type="number"
            min={1}
            value={config.reiniciar_apos_horas}
            onChange={(e) => setConfig({ ...config, reiniciar_apos_horas: Number(e.target.value) })}
            className="w-16 rounded border border-cinza-claro px-2 py-1"
          />
          <span>horas, a próxima mensagem do cliente começa uma conversa nova com o assistente.</span>
        </div>
        <p className="text-xs text-cinza-medio">Quem está esperando na fila nunca perde o lugar, mesmo depois desse tempo.</p>
      </Secao>

      <Secao
        numero={7}
        titulo="Respostas prontas para as atendentes"
        ajuda="Frases que aparecem como botões na tela de atendimento, para a atendente mandar com um clique. Uma por linha, até 12."
      >
        <textarea
          value={respostas}
          onChange={(e) => setRespostas(e.target.value)}
          rows={7}
          className="w-full rounded-lg border border-cinza-claro px-3 py-2 text-sm focus:outline-none focus:border-vermelho"
        />
      </Secao>

      {/* Barra de salvar: fica sempre visível no rodapé da tela. */}
      <div className="fixed bottom-0 inset-x-0 z-20 border-t border-cinza-claro bg-white/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center gap-4">
          <button
            onClick={salvar}
            disabled={pendente || !alterado}
            className="rounded-lg bg-vermelho text-white px-6 py-2.5 font-heading font-bold disabled:opacity-40"
          >
            {pendente ? "Salvando..." : "Salvar alterações"}
          </button>
          {msg && (msg.tipo === "erro" || !alterado) ? (
            <span className={`text-sm font-semibold ${msg.tipo === "ok" ? "text-green-800" : "text-red-700"}`}>{msg.texto}</span>
          ) : alterado ? (
            <span className="text-sm font-semibold text-amber-700">Você tem alterações não salvas.</span>
          ) : (
            <span className="text-sm text-cinza-medio">Tudo salvo.</span>
          )}
        </div>
      </div>
    </div>
  );
}
