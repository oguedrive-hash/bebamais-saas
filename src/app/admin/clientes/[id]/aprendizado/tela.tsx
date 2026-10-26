import Link from "next/link";
import type { FraseContada, Padroes } from "@/lib/aprendizado/padroes";
import { formatarTelefone } from "@/lib/atendimento/painel";
import { PainelConexao, BotaoImportar, BotaoApagarTudo, BotaoExcluirContato } from "./controles";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface DadosAprendizado {
  id: string;
  cfg: {
    instance_name: string;
    status_conexao: string | null;
    numero: string | null;
    conectado_em: string | null;
    historico_importado_em: string | null;
  } | null;
  total: number | null;
  daEquipe: number | null;
  primeira: { enviada_em: string } | null;
  ultima: { enviada_em: string } | null;
  conversas: {
    conversa_jid: string;
    nome_contato: string | null;
    telefone: string | null;
    mensagens: number;
    da_equipe: number;
    ultima: string;
  }[] | null;
  conversaAberta: string | undefined;
  mensagens: { id: string; direcao: string; tipo: string; conteudo: string | null; enviada_em: string }[] | null;
  padroes: Padroes;
  diasCaptando: number;
}

/** O que a tela do Aprendizado mostra (os dados vêm de page.tsx). */
export function TelaAprendizado({
  id,
  cfg,
  total,
  daEquipe,
  primeira,
  ultima,
  conversas,
  conversaAberta,
  mensagens,
  padroes,
  diasCaptando,
}: DadosAprendizado) {
  const conversaInfo = (conversas ?? []).find((cv) => cv.conversa_jid === conversaAberta);
  const conectado = cfg?.status_conexao === "open";
  const numConversas = conversas?.length ?? 0;

  const passos = [
    {
      feito: conectado,
      titulo: "Conectar o WhatsApp da loja (só leitura)",
      detalhe: conectado
        ? `Conectado${cfg?.numero ? ` (${formatarTelefone(cfg.numero)})` : ""}${cfg?.conectado_em ? ` desde ${new Date(cfg.conectado_em).toLocaleDateString("pt-BR")}` : ""}.`
        : "Use o WhatsApp de maior movimento, aquele que a equipe já usa para atender.",
    },
    {
      feito: !!cfg?.historico_importado_em,
      titulo: "Trazer as conversas antigas",
      detalhe: cfg?.historico_importado_em
        ? `Feito em ${new Date(cfg.historico_importado_em).toLocaleString("pt-BR")}. Pode clicar de novo depois: só entra o que for novo.`
        : "Ao conectar, o WhatsApp manda as conversas recentes. Espere uns 10 minutos e clique em “Trazer as conversas antigas”.",
    },
    {
      feito: conectado && diasCaptando >= 3,
      titulo: "Deixar captando de 3 a 7 dias",
      detalhe: conectado ? `${diasCaptando} dia(s) captando. As conversas novas entram sozinhas.` : "Depois de conectar, é só deixar ligado.",
    },
    {
      feito: false,
      titulo: "Ver os padrões e ajustar o assistente",
      detalhe: "Os padrões aparecem abaixo. Nada muda sozinho: os ajustes são feitos em Assistente → Informações da loja.",
    },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-4xl font-heading font-bold text-preto">Aprendizado</h1>
        <p className="text-cinza-medio mt-2 max-w-3xl">
          O WhatsApp de maior movimento da loja fica conectado <strong>só para ler</strong>. O sistema guarda as conversas
          reais entre clientes e equipe para descobrir as perguntas mais comuns e o jeito de a equipe atender. Com isso, o
          assistente fica mais parecido com a loja. Ele <strong>nunca</strong> responde por este número, e nada daqui aparece
          na tela de atendimento.
        </p>
      </div>

      <ol className="space-y-2 mb-6">
        {passos.map((p, i) => (
          <li key={p.titulo} className="flex items-start gap-3 rounded-2xl border border-cinza-claro bg-white p-4">
            <span
              className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center font-heading font-bold ${
                p.feito ? "bg-green-600 text-white" : "bg-white text-preto border-2 border-cinza-claro"
              }`}
            >
              {p.feito ? "✓" : i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-heading font-bold text-preto">{p.titulo}</p>
              <p className="text-sm text-cinza-medio">{p.detalhe}</p>
            </div>
          </li>
        ))}
      </ol>

      {!cfg || !conectado ? (
        <section className="p-5 rounded-2xl border border-cinza-claro bg-white mb-6">
          <h2 className="text-lg font-heading font-bold text-preto">Conectar o WhatsApp da loja</h2>
          <ul className="text-sm text-preto mt-3 space-y-1.5 list-disc pl-5">
            <li>Use o celular com o WhatsApp que a equipe usa para atender os clientes.</li>
            <li>
              O celular continua funcionando normal. As mensagens <strong>não</strong> são marcadas como lidas, nada é enviado
              e os grupos são ignorados.
            </li>
            <li>Se depois este número também for atender pelo sistema, desconecte o aprendizado antes de adicioná-lo em Números.</li>
          </ul>
          <div className="mt-4 p-3 rounded-lg text-sm bg-amber-50 border border-amber-200 text-amber-900">
            <strong>Antes de conectar:</strong> a conexão é do tipo “WhatsApp Web” (não oficial). Só ler tem risco baixo, mas
            não zero, de o WhatsApp restringir o número. Conversas pessoais deste celular também seriam captadas: dá para
            tirar um contato depois, com “Não captar este contato”, ou apagar tudo no fim.
          </div>
          <PainelConexao organizationId={id} temConexao={!!cfg} />
        </section>
      ) : (
        <section className="p-5 rounded-2xl border-2 border-green-600 bg-green-50 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-heading font-semibold uppercase tracking-wide text-green-800">● Captando</p>
              <p className="text-lg font-heading font-bold text-preto">
                WhatsApp da loja conectado{cfg.numero ? ` · ${formatarTelefone(cfg.numero)}` : ""}
              </p>
              <p className="text-sm text-cinza-medio mt-1">
                {cfg.historico_importado_em
                  ? `Conversas antigas trazidas em ${new Date(cfg.historico_importado_em).toLocaleString("pt-BR")}.`
                  : "As conversas antigas ainda não foram trazidas."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BotaoImportar organizationId={id} destaque={!cfg.historico_importado_em} />
              <PainelConexao organizationId={id} temConexao conectado />
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Numero rotulo="Conversas" valor={numConversas >= 150 ? "150+" : String(numConversas)} />
        <Numero rotulo="Mensagens" valor={(total ?? 0).toLocaleString("pt-BR")} />
        <Numero rotulo="Da equipe" valor={(daEquipe ?? 0).toLocaleString("pt-BR")} />
        <Numero
          rotulo="Período"
          valor={
            primeira && ultima
              ? `${new Date(primeira.enviada_em).toLocaleDateString("pt-BR")} a ${new Date(ultima.enviada_em).toLocaleDateString("pt-BR")}`
              : "—"
          }
        />
      </section>

      <h2 className="text-2xl font-heading font-bold text-preto mb-1">Padrões encontrados</h2>
      <p className="text-sm text-cinza-medio mb-4">
        {padroes.mensagens
          ? `Calculado com as ${padroes.mensagens.toLocaleString("pt-BR")} mensagens mais recentes (${padroes.conversas.toLocaleString("pt-BR")} conversas).`
          : "Aparece aqui assim que houver conversas captadas."}
      </p>
      {padroes.mensagens > 0 && (
        <div className="grid gap-4 lg:grid-cols-2 mb-8">
          <Cartao titulo="Quando os clientes mais chamam" ajuda="Mensagens de clientes por hora do dia.">
            <Barras valores={padroes.porHora} rotulos={padroes.porHora.map((_, h) => (h % 3 === 0 ? `${h}h` : ""))} />
            <div className="mt-4">
              <Barras valores={padroes.porDia} rotulos={DIAS_SEMANA} />
            </div>
          </Cartao>
          <Cartao titulo="Quanto a equipe demora para responder" ajuda="Do momento em que o cliente chama até a primeira resposta da equipe.">
            {padroes.respostaMedianaMin === null ? (
              <p className="text-sm text-cinza-medio">Ainda não há respostas suficientes para medir.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-3xl font-heading font-bold text-preto">
                  {padroes.respostaMedianaMin < 1 ? "menos de 1 min" : `${padroes.respostaMedianaMin} min`}
                </p>
                <p className="text-sm text-cinza-medio">
                  Na metade das vezes, a equipe respondeu em até esse tempo. Em{" "}
                  <strong>{Math.round((padroes.respondidasAte5Min / padroes.respostasMedidas) * 100)}%</strong> das vezes, em até 5
                  minutos ({padroes.respostasMedidas.toLocaleString("pt-BR")} respostas medidas).
                </p>
                <p className="text-sm text-cinza-medio">
                  Os horários de pico (ao lado) somados a um tempo de resposta alto mostram onde o assistente mais ajuda.
                </p>
              </div>
            )}
          </Cartao>
          <Cartao titulo="Frases que a equipe mais usa" ajuda="O jeito de a equipe falar. Serve para ajustar o tom do assistente.">
            <ListaFrases frases={padroes.frasesEquipe} />
          </Cartao>
          <Cartao titulo="Como os clientes começam a conversa" ajuda="As primeiras mensagens mais comuns. Mostram o que o assistente mais vai ouvir.">
            <ListaFrases frases={padroes.aberturasClientes} />
          </Cartao>
        </div>
      )}

      <h2 className="text-2xl font-heading font-bold text-preto mb-3">Ler as conversas</h2>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="rounded-2xl border border-cinza-claro bg-white overflow-hidden">
          <h3 className="px-4 py-3 text-sm font-heading font-bold text-preto border-b border-cinza-claro">Conversas captadas</h3>
          {numConversas === 0 ? (
            <p className="px-4 py-6 text-sm text-cinza-medio">Nada captado ainda.</p>
          ) : (
            <ul className="max-h-[560px] overflow-y-auto divide-y divide-cinza-claro">
              {(conversas ?? []).map((cv) => (
                <li key={cv.conversa_jid}>
                  <Link
                    href={`?c=${encodeURIComponent(cv.conversa_jid)}`}
                    scroll={false}
                    className={`block px-4 py-2.5 hover:bg-offwhite ${cv.conversa_jid === conversaAberta ? "bg-offwhite" : ""}`}
                  >
                    <p className="text-sm font-heading font-semibold text-preto truncate">{cv.nome_contato ?? cv.telefone ?? "Sem nome"}</p>
                    <p className="text-xs text-cinza-medio">
                      {cv.mensagens} mensagens · {cv.da_equipe} da equipe · {new Date(cv.ultima).toLocaleDateString("pt-BR")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-cinza-claro bg-white overflow-hidden">
          {!conversaAberta ? (
            <p className="px-4 py-6 text-sm text-cinza-medio">Escolha uma conversa para ler.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-cinza-claro">
                <h3 className="text-sm font-heading font-bold text-preto truncate">
                  {conversaInfo?.nome_contato ?? conversaInfo?.telefone ?? "Conversa"}
                </h3>
                <BotaoExcluirContato organizationId={id} conversaJid={conversaAberta} />
              </div>
              <div className="max-h-[560px] overflow-y-auto p-4 space-y-2 bg-[#efeae2]">
                {(mensagens ?? []).map((m) => (
                  <div key={m.id} className={`flex ${m.direcao === "equipe" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm shadow-sm ${m.direcao === "equipe" ? "bg-[#d9fdd3]" : "bg-white"}`}>
                      <p className="text-xs font-heading font-semibold text-cinza-medio mb-0.5">
                        {m.direcao === "equipe" ? "Equipe" : "Cliente"}
                        {m.tipo !== "texto" ? ` · ${m.tipo}` : ""}
                      </p>
                      <p className="text-preto whitespace-pre-wrap">
                        {m.conteudo ?? (m.tipo === "audio" ? "(áudio sem transcrição)" : `(${m.tipo})`)}
                      </p>
                      <p className="text-xs text-cinza-medio mt-1 text-right">
                        {new Date(m.enviada_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="mt-8 p-4 rounded-2xl border border-red-200 bg-white">
        <p className="text-xs font-heading font-semibold uppercase tracking-wide text-red-700">Apagar tudo que foi captado</p>
        <p className="text-sm text-cinza-medio mt-1">
          Apaga as conversas guardadas aqui (use no fim do aprendizado). Não desconecta o WhatsApp.
        </p>
        <div className="mt-2">
          <BotaoApagarTudo organizationId={id} />
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="p-4 rounded-2xl bg-white border border-cinza-claro">
      <p className="text-xs text-cinza-medio font-heading font-semibold">{rotulo}</p>
      <p className="text-lg font-heading font-bold text-preto mt-1">{valor}</p>
    </div>
  );
}

function Cartao({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-cinza-claro bg-white p-5">
      <h3 className="font-heading font-bold text-preto">{titulo}</h3>
      <p className="text-xs text-cinza-medio mb-3">{ajuda}</p>
      {children}
    </section>
  );
}

/** Gráfico de barras simples (sem biblioteca). */
function Barras({ valores, rotulos }: { valores: number[]; rotulos: string[] }) {
  const maior = Math.max(1, ...valores);
  return (
    <div>
      <div className="flex items-end gap-1 h-24">
        {valores.map((v, i) => (
          <div
            key={i}
            title={`${v.toLocaleString("pt-BR")} mensagens`}
            className="flex-1 rounded-t bg-vermelho/80"
            style={{ height: `${Math.max(2, Math.round((v / maior) * 100))}%` }}
          />
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {rotulos.map((r, i) => (
          <span key={i} className="flex-1 text-center text-[10px] text-cinza-medio">
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

function ListaFrases({ frases }: { frases: FraseContada[] }) {
  if (!frases.length) return <p className="text-sm text-cinza-medio">Ainda não há frases repetidas suficientes.</p>;
  return (
    <ol className="space-y-1.5">
      {frases.map((f) => (
        <li key={f.exemplo} className="flex items-start justify-between gap-3 text-sm">
          <span className="text-preto">“{f.exemplo}”</span>
          <span className="shrink-0 text-xs font-semibold text-cinza-medio">{f.vezes}x</span>
        </li>
      ))}
    </ol>
  );
}
