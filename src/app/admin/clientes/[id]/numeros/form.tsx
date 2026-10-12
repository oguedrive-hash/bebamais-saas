"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adicionarNumero,
  atualizarNumero,
  desconectarNumero,
  estadoConexao,
  excluirNumero,
  gerarQrNumero,
  reconfigurarConexao,
  type NumeroRow,
} from "./actions";

type NumeroView = NumeroRow & { conexao: string };

/** Quem o assistente atende num número. Vem de ia_ativa + numeros_teste. */
type Modo = "ninguem" | "teste" | "todos";

/** "19989578988" → "(19) 98957-8988" (só para mostrar). */
function formatarTelefone(digitos: string | null): string {
  const d = (digitos ?? "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d;
}

/**
 * Lista de telefones de teste como a pessoa digitou ("(19) 99271-6446, 19 98888-7777")
 * → só dígitos, um por item. Separa por vírgula, ponto e vírgula ou linha (nunca por
 * espaço: "(19) 99271-6446" é UM telefone).
 */
function telefonesDeTeste(texto: string): { lista: string[]; invalidos: string[] } {
  const itens = texto.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
  const lista: string[] = [];
  const invalidos: string[] = [];
  for (const t of itens) {
    const d = t.replace(/\D/g, "");
    if (d.length >= 10) lista.push(d);
    else invalidos.push(t);
  }
  return { lista: [...new Set(lista)], invalidos };
}

function modoDe(n: NumeroRow): Modo {
  if (!n.ia_ativa) return "ninguem";
  return telefonesDeTeste(n.numeros_teste ?? "").lista.length ? "teste" : "todos";
}

function Status({ conexao }: { conexao: string }) {
  if (conexao === "open") {
    return <span className="rounded-full bg-green-50 text-green-800 border border-green-200 px-3 py-1 text-sm font-semibold">● Conectado e funcionando</span>;
  }
  if (conexao === "connecting") {
    return <span className="rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 text-sm font-semibold">● Esperando ler o QR Code</span>;
  }
  if (conexao === "close") {
    return <span className="rounded-full bg-red-50 text-red-800 border border-red-200 px-3 py-1 text-sm font-semibold">● Desconectado</span>;
  }
  return <span className="rounded-full bg-offwhite text-cinza-medio border border-cinza-claro px-3 py-1 text-sm">● Não foi possível verificar</span>;
}

const campo = "w-full rounded-lg border border-cinza-claro px-3 py-2 focus:outline-none focus:border-vermelho";

export function NumerosManager({
  organizationId,
  inicial,
  erroInicial,
}: {
  organizationId: string;
  inicial: NumeroView[];
  erroInicial: string | null;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const [novo, setNovo] = useState({ numero: "", apelido: "", nomeAssistente: "" });
  const [qr, setQr] = useState<{ instance: string; base64?: string; pairing?: string | null } | null>(null);

  function rodar(acao: () => Promise<{ ok: true } | { error: string } | { ok: true; instance_name: string }>, ok?: string) {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      const r = await acao();
      if ("error" in r) setErro(r.error);
      else {
        if (ok) setAviso(ok);
        router.refresh();
      }
    });
  }

  function abrirQr(instance: string) {
    setErro(null);
    iniciar(async () => {
      const r = await gerarQrNumero(instance);
      if ("error" in r) setErro(r.error);
      else setQr({ instance, base64: r.base64, pairing: r.pairingCode });
    });
  }

  // Enquanto o QR está aberto, confere a cada 4s se o número conectou.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(async () => {
      if ((await estadoConexao(qr.instance)) === "open") {
        setQr(null);
        setAviso("Número conectado! Agora escolha, no cartão dele, quem o assistente atende.");
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [qr, router]);

  return (
    <div className="space-y-6">
      {erro && <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm">{erro}</div>}
      {aviso && <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3 text-sm">{aviso}</div>}

      {inicial.length === 0 && (
        <div className="rounded-2xl border border-dashed border-cinza-claro bg-white p-5 text-cinza-medio">
          Nenhum número ainda. Comece adicionando o WhatsApp da loja (ou um chip de teste) logo abaixo.
        </div>
      )}

      {inicial.map((n) => (
        <CartaoNumero
          key={`${n.id}-${n.ia_ativa}-${n.numeros_teste ?? ""}-${n.apelido ?? ""}-${n.persona_nome ?? ""}`}
          n={n}
          pendente={pendente}
          onSalvar={(patch, msg) => rodar(() => atualizarNumero(organizationId, n.id, patch), msg)}
          onConectar={() => abrirQr(n.instance_name)}
          onDesconectar={() => {
            const nome = n.apelido ?? formatarTelefone(n.numero);
            if (
              window.confirm(
                `Desconectar o WhatsApp "${nome}" do sistema?\n\n` +
                  "As mensagens desse número param de chegar no painel e o assistente para de responder nele. " +
                  "O WhatsApp no celular continua funcionando normalmente e as conversas antigas ficam salvas.\n\n" +
                  "Para voltar a usar, é só clicar em “Conectar (ler QR Code)”.",
              )
            ) {
              rodar(
                () => desconectarNumero(organizationId, n.id, n.instance_name),
                `Número "${nome}" desconectado. Para voltar a usar, clique em “Conectar (ler QR Code)”.`,
              );
            }
          }}
          onReconfigurar={() => rodar(() => reconfigurarConexao(n.instance_name), "Conexão refeita. Mande uma mensagem de teste para conferir se chega no painel.")}
          onExcluir={() => {
            const nome = n.apelido ?? formatarTelefone(n.numero);
            if (
              window.confirm(
                `Remover o número "${nome}" do sistema?\n\n` +
                  "As mensagens desse WhatsApp param de chegar no painel e o assistente para de responder nele. " +
                  "As conversas antigas continuam salvas. Para usar de novo, será preciso adicionar e ler o QR Code outra vez.",
              )
            ) {
              rodar(() => excluirNumero(organizationId, n.id, n.instance_name), "Número removido.");
            }
          }}
        />
      ))}

      <div className="rounded-2xl border border-cinza-claro bg-white p-5">
        <p className="font-heading font-bold text-lg text-preto">Adicionar um número de WhatsApp</p>
        <ol className="mt-2 mb-4 text-sm text-cinza-medio list-decimal pl-5 space-y-0.5">
          <li>Preencha o telefone e um apelido.</li>
          <li>Clique em “Adicionar e conectar”: vai aparecer um QR Code.</li>
          <li>No celular desse número, leia o QR Code pelo WhatsApp (as instruções aparecem na tela).</li>
        </ol>
        <div className="grid md:grid-cols-3 gap-3">
          <label className="text-sm flex flex-col">
            <span className="block font-semibold text-preto mb-0.5">Telefone com DDD</span>
            <span className="block text-xs text-cinza-medio mb-1">O número do WhatsApp que vai atender.</span>
            <input value={novo.numero} onChange={(e) => setNovo({ ...novo, numero: e.target.value })} placeholder="(19) 99999-9999" className={`${campo} mt-auto`} />
          </label>
          <label className="text-sm flex flex-col">
            <span className="block font-semibold text-preto mb-0.5">Apelido do número</span>
            <span className="block text-xs text-cinza-medio mb-1">Só a equipe vê. Ex.: Loja, Vendas, Chip de teste.</span>
            <input value={novo.apelido} onChange={(e) => setNovo({ ...novo, apelido: e.target.value })} placeholder="Loja" className={`${campo} mt-auto`} />
          </label>
          <label className="text-sm flex flex-col">
            <span className="block font-semibold text-preto mb-0.5">Nome do assistente</span>
            <span className="block text-xs text-cinza-medio mb-1">Opcional. Como ele se chama, se o cliente perguntar.</span>
            <input value={novo.nomeAssistente} onChange={(e) => setNovo({ ...novo, nomeAssistente: e.target.value })} placeholder="Assistente Beba Mais" className={`${campo} mt-auto`} />
          </label>
        </div>
        <p className="mt-3 text-xs text-cinza-medio">
          Por segurança, o número novo começa com o assistente <strong>desligado</strong>. Depois de conectar, escolha no cartão dele quem o assistente atende.
        </p>
        <button
          disabled={pendente}
          onClick={() =>
            rodar(async () => {
              const r = await adicionarNumero(organizationId, novo);
              if ("ok" in r) {
                setNovo({ numero: "", apelido: "", nomeAssistente: "" });
                abrirQr(r.instance_name);
              }
              return r;
            })
          }
          className="mt-4 rounded-lg bg-vermelho text-white px-5 py-2.5 font-heading font-bold disabled:opacity-50"
        >
          Adicionar e conectar
        </button>
      </div>

      {qr && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setQr(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-heading font-bold text-lg mb-3 text-center">Conectar o WhatsApp</p>
            <ol className="text-sm text-preto list-decimal pl-5 space-y-1 mb-4">
              <li>Pegue o celular com o WhatsApp deste número.</li>
              <li>
                Abra o WhatsApp e toque em <strong>⋮</strong> (Android) ou em <strong>Configurações</strong> (iPhone).
              </li>
              <li>
                Toque em <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong>.
              </li>
              <li>Aponte a câmera do celular para o código abaixo.</li>
            </ol>
            {qr.base64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.base64} alt="QR Code para conectar o WhatsApp" className="mx-auto w-64 h-64" />
            ) : (
              <p className="text-sm text-center">O código ainda não ficou pronto. Feche esta janela e clique em “Conectar” de novo.</p>
            )}
            {qr.pairing && (
              <p className="mt-3 text-sm text-center">
                Sem câmera? Use o código: <strong className="tracking-widest">{qr.pairing}</strong>
              </p>
            )}
            <p className="mt-3 text-xs text-cinza-medio text-center">Esta janela fecha sozinha quando conectar.</p>
            <div className="text-center">
              <button onClick={() => setQr(null)} className="mt-4 rounded-lg border border-cinza-claro px-4 py-2 font-semibold">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OpcaoModo(props: {
  valor: Modo;
  atual: Modo;
  titulo: string;
  selo?: string;
  texto: string;
  onEscolher: (m: Modo) => void;
  children?: React.ReactNode;
}) {
  const ativo = props.valor === props.atual;
  return (
    <label
      className={`flex gap-3 rounded-lg px-4 py-3 cursor-pointer transition ${
        ativo ? "border-2 border-vermelho bg-red-50/40" : "border border-cinza-claro hover:bg-offwhite"
      }`}
    >
      <input type="radio" checked={ativo} onChange={() => props.onEscolher(props.valor)} className="mt-1 h-4 w-4 accent-[#cc1b1b]" />
      <span className="flex-1">
        <span className="font-semibold text-preto">{props.titulo}</span>
        {props.selo && <span className="ml-2 text-[11px] font-semibold rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">{props.selo}</span>}
        <span className="block text-sm text-cinza-medio">{props.texto}</span>
        {ativo && props.children}
      </span>
    </label>
  );
}

function CartaoNumero(props: {
  n: NumeroView;
  pendente: boolean;
  onSalvar: (patch: Partial<NumeroRow>, mensagem: string) => void;
  onConectar: () => void;
  onDesconectar: () => void;
  onReconfigurar: () => void;
  onExcluir: () => void;
}) {
  const { n } = props;
  const modoInicial = modoDe(n);
  const testesIniciais = telefonesDeTeste(n.numeros_teste ?? "").lista.map(formatarTelefone).join(", ");
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [testes, setTestes] = useState(testesIniciais);
  const [apelido, setApelido] = useState(n.apelido ?? "");
  const [persona, setPersona] = useState(n.persona_nome ?? "");
  const [erro, setErro] = useState<string | null>(null);

  const alterado =
    modo !== modoInicial || testes !== testesIniciais || apelido !== (n.apelido ?? "") || persona !== (n.persona_nome ?? "");

  function salvar() {
    setErro(null);
    const { lista, invalidos } = telefonesDeTeste(testes);
    if (modo === "teste") {
      if (invalidos.length) {
        setErro(`Confira estes telefones (precisam ter DDD): ${invalidos.join(", ")}`);
        return;
      }
      if (!lista.length) {
        setErro("Coloque pelo menos um telefone de teste, ou escolha outra opção.");
        return;
      }
    }
    if (modo === "todos" && modoInicial !== "todos") {
      const ok = window.confirm(
        "O assistente vai responder TODOS os clientes que escreverem para este número.\n\nUse isso só quando os testes estiverem aprovados. Confirmar?",
      );
      if (!ok) return;
    }
    const mensagens: Record<Modo, string> = {
      ninguem: "Salvo. O assistente está desligado neste número: as mensagens vão direto para as atendentes.",
      teste: `Salvo. O assistente responde só ${lista.length === 1 ? "o telefone de teste" : `os ${lista.length} telefones de teste`}.`,
      todos: "Salvo. O assistente responde todos os clientes deste número.",
    };
    props.onSalvar(
      {
        apelido: apelido.trim() || null,
        persona_nome: persona.trim() || null,
        ia_ativa: modo !== "ninguem",
        // "Todos" apaga a lista; "Ninguém" guarda a lista para voltar ao teste depois.
        numeros_teste: modo === "todos" ? null : lista.join(", ") || null,
      },
      mensagens[modo],
    );
  }

  return (
    <div className="rounded-2xl border border-cinza-claro bg-white p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-heading font-bold text-lg text-preto">{n.apelido || "Número sem apelido"}</p>
          <p className="text-sm text-cinza-medio">{formatarTelefone(n.numero)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Status conexao={n.conexao} />
          {n.conexao === "open" && (
            <button
              onClick={props.onDesconectar}
              disabled={props.pendente}
              className="rounded-lg border border-cinza-claro bg-white px-4 py-2 text-sm font-semibold text-preto hover:border-preto disabled:opacity-50"
            >
              Desconectar
            </button>
          )}
          {n.conexao !== "open" && (
            <button onClick={props.onConectar} disabled={props.pendente} className="rounded-lg bg-preto text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
              Conectar (ler QR Code)
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-heading font-semibold text-preto">1. Quem o assistente atende neste número?</p>
        <OpcaoModo
          valor="ninguem"
          atual={modo}
          onEscolher={setModo}
          titulo="Ninguém"
          texto="O assistente fica desligado. Toda mensagem vai direto para a fila das atendentes."
        />
        <OpcaoModo
          valor="teste"
          atual={modo}
          onEscolher={setModo}
          titulo="Só os telefones de teste"
          selo="use enquanto testa"
          texto="O assistente responde só estes telefones. Os outros clientes vão direto para as atendentes."
        >
          <input
            value={testes}
            onChange={(e) => setTestes(e.target.value)}
            placeholder="(19) 99999-8888, (19) 98888-7777"
            className={`${campo} mt-2 text-sm`}
            aria-label="Telefones de teste"
          />
          <span className="block mt-1 text-xs text-cinza-medio">Com DDD. Para mais de um, separe por vírgula.</span>
        </OpcaoModo>
        <OpcaoModo
          valor="todos"
          atual={modo}
          onEscolher={setModo}
          titulo="Todos os clientes"
          texto="O assistente responde todo mundo que escrever para este número. Use quando estiver tudo aprovado."
        />
      </div>

      <div className="space-y-2">
        <p className="font-heading font-semibold text-preto">2. Nomes</p>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-sm flex flex-col">
            <span className="block font-semibold text-preto mb-0.5">Apelido do número</span>
            <span className="block text-xs text-cinza-medio mb-1">Só a equipe vê. Mostra no painel por qual número o cliente escreveu.</span>
            <input value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="Loja" className={`${campo} mt-auto`} />
          </label>
          <label className="text-sm flex flex-col">
            <span className="block font-semibold text-preto mb-0.5">Nome do assistente</span>
            <span className="block text-xs text-cinza-medio mb-1">Como ele se chama, se o cliente perguntar.</span>
            <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Assistente Beba Mais" className={`${campo} mt-auto`} />
          </label>
        </div>
      </div>

      {erro && <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-2 text-sm">{erro}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={salvar}
          disabled={props.pendente || !alterado}
          className="rounded-lg bg-vermelho text-white px-5 py-2.5 text-sm font-heading font-bold disabled:opacity-40"
        >
          {props.pendente ? "Salvando..." : "Salvar alterações"}
        </button>
        {alterado ? (
          <span className="text-sm font-semibold text-amber-700">Você tem alterações não salvas.</span>
        ) : (
          <span className="text-sm text-cinza-medio">Tudo salvo.</span>
        )}
      </div>

      <details className="border-t border-cinza-claro pt-3 text-sm">
        <summary className="cursor-pointer text-cinza-medio font-semibold hover:text-preto">Problemas com este número?</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-cinza-medio">As mensagens pararam de chegar no painel, mesmo com o número conectado?</span>
            <button onClick={props.onReconfigurar} disabled={props.pendente} className="rounded-lg border border-cinza-claro px-3 py-2 font-semibold disabled:opacity-50">
              Consertar conexão
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-cinza-medio">Não vai mais usar este número no sistema?</span>
            <button onClick={props.onExcluir} disabled={props.pendente} className="rounded-lg border border-red-200 text-red-700 px-3 py-2 font-semibold disabled:opacity-50">
              Remover número
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
