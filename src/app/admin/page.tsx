import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIAS, NOME_DIA, normalizarConfig, type AtendimentoConfig } from "@/lib/atendimento/regras";
import { listarNumeros } from "./clientes/[id]/numeros/actions";

export const dynamic = "force-dynamic";

/** "segunda-feira a sábado, 08:00 às 18:00; domingo fechado". */
function resumoHorarios(cfg: AtendimentoConfig): string {
  const grupos: { de: string; ate: string; texto: string }[] = [];
  for (const d of DIAS.slice(1).concat(DIAS[0])) {
    const h = cfg.horarios[d];
    const texto = h ? `${h.abre} às ${h.fecha}` : "fechado";
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.texto === texto) ultimo.ate = NOME_DIA[d];
    else grupos.push({ de: NOME_DIA[d], ate: NOME_DIA[d], texto });
  }
  return grupos.map((g) => `${g.de === g.ate ? g.de : `${g.de} a ${g.ate}`}, ${g.texto}`).join("; ");
}

type Estado = "feito" | "atencao" | "falta";

function Passo(props: { n: number; estado: Estado; titulo: string; detalhe: string; href: string; acao: string }) {
  const icone = props.estado === "feito" ? "✓" : props.estado === "atencao" ? "!" : String(props.n);
  const cor =
    props.estado === "feito"
      ? "bg-green-600 text-white"
      : props.estado === "atencao"
        ? "bg-amber-500 text-white"
        : "bg-white text-preto border-2 border-cinza-claro";
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-cinza-claro bg-white p-4">
      <span className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center font-heading font-bold ${cor}`}>{icone}</span>
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-preto">{props.titulo}</p>
        <p className="text-sm text-cinza-medio">{props.detalhe}</p>
      </div>
      <Link
        href={props.href}
        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-heading font-semibold ${
          props.estado === "feito" ? "border border-cinza-claro text-preto hover:bg-offwhite" : "bg-vermelho text-white"
        }`}
      >
        {props.estado === "feito" ? "Ver" : props.acao}
      </Link>
    </li>
  );
}

/** /admin: lista do que já está pronto e do que falta para o sistema atender. */
export default async function PrimeirosPassos() {
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!orgId) notFound();
  const admin = createAdminClient();
  const [{ data: org }, numerosRes, { count: atendentes }, { count: conversas }] = await Promise.all([
    admin.from("organizations").select("name, base_conhecimento, atendimento_config").eq("id", orgId).maybeSingle(),
    listarNumeros(orgId),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("role", "client"),
    admin.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
  ]);
  if (!org) notFound();

  const cfg = normalizarConfig(org.atendimento_config);
  const numeros = "numeros" in numerosRes ? numerosRes.numeros : [];
  const conectados = numeros.filter((n) => n.conexao === "open");
  const comTeste = numeros.filter((n) => n.ia_ativa && (n.numeros_teste ?? "").replace(/\D/g, "").length >= 10);
  const paraTodos = numeros.filter((n) => n.ia_ativa && (n.numeros_teste ?? "").replace(/\D/g, "").length < 10);
  const base = (sub: string) => `/admin/clientes/${orgId}/${sub}`;
  const infos = (org.base_conhecimento ?? "").trim().length;

  let quemAtende: { estado: Estado; detalhe: string };
  if (!cfg.assistente_ativo) quemAtende = { estado: "atencao", detalhe: "O assistente está desligado para a loja toda (tela Assistente)." };
  else if (!numeros.length) quemAtende = { estado: "falta", detalhe: "Primeiro conecte um número." };
  else if (paraTodos.length) quemAtende = { estado: "feito", detalhe: `Respondendo todos os clientes em: ${paraTodos.map((n) => n.apelido ?? n.numero).join(", ")}.` };
  else if (comTeste.length) quemAtende = { estado: "atencao", detalhe: "Em teste: o assistente só responde os telefones de teste. Quando aprovar, escolha “Todos os clientes”." };
  else quemAtende = { estado: "falta", detalhe: "O assistente está desligado em todos os números. Escolha quem ele atende." };

  const passos = [
    {
      estado: (infos >= 80 ? "feito" : "falta") as Estado,
      titulo: "Ensinar o assistente sobre a loja",
      detalhe: infos >= 80 ? "Informações da loja preenchidas." : "Escreva endereço, entrega, pagamento e o que a loja vende.",
      href: base("assistente"),
      acao: "Fazer agora",
    },
    {
      estado: "feito" as Estado,
      titulo: "Conferir o horário de atendimento",
      detalhe: `${resumoHorarios(cfg)}. Confira se está certo.`,
      href: base("assistente"),
      acao: "Conferir",
    },
    {
      estado: (cfg.dias_fechados.length ? "feito" : "falta") as Estado,
      titulo: "Cadastrar os feriados",
      detalhe: cfg.dias_fechados.length
        ? `${cfg.dias_fechados.length} dia(s) fechado(s) cadastrado(s).`
        : "Nenhum feriado cadastrado: nesses dias o assistente diria que a loja está aberta.",
      href: base("assistente"),
      acao: "Fazer agora",
    },
    {
      estado: (conectados.length ? "feito" : "falta") as Estado,
      titulo: "Conectar o WhatsApp",
      detalhe: conectados.length
        ? `Conectado: ${conectados.map((n) => n.apelido ?? n.numero).join(", ")}.`
        : numeros.length
          ? "Há número cadastrado, mas desconectado. Leia o QR Code."
          : "Adicione o número e leia o QR Code com o celular.",
      href: base("numeros"),
      acao: "Fazer agora",
    },
    { ...quemAtende, titulo: "Escolher quem o assistente atende", href: base("numeros"), acao: "Escolher" },
    {
      estado: ((atendentes ?? 0) > 0 ? "feito" : "falta") as Estado,
      titulo: "Criar o acesso das atendentes",
      detalhe: (atendentes ?? 0) > 0 ? `${atendentes} atendente(s) com acesso.` : "Ninguém da equipe tem acesso ainda.",
      href: base("usuarios"),
      acao: "Fazer agora",
    },
  ];
  const prontos = passos.filter((p) => p.estado === "feito").length;

  return (
    <div className="max-w-3xl">
      <h1 className="text-4xl font-heading font-bold text-preto">Primeiros passos</h1>
      <p className="text-cinza-medio mt-2">
        Siga a lista de cima para baixo. Quando tudo estiver verde, o sistema está pronto para atender os clientes da {org.name}.
      </p>
      <div className="mt-5 mb-6">
        <div className="flex justify-between text-sm font-heading font-semibold text-preto mb-1">
          <span>{prontos} de {passos.length} prontos</span>
          {conversas ? <span className="text-cinza-medio font-normal">{conversas} conversa(s) já recebida(s)</span> : null}
        </div>
        <div className="h-2.5 rounded-full bg-cinza-claro overflow-hidden">
          <div className="h-full bg-green-600 rounded-full" style={{ width: `${Math.round((prontos / passos.length) * 100)}%` }} />
        </div>
      </div>
      <ol className="space-y-3">
        {passos.map((p, i) => (
          <Passo key={p.titulo} n={i + 1} {...p} />
        ))}
      </ol>
      <p className="mt-6 text-sm text-cinza-medio">
        Dica: enquanto testa, deixe o número em “Só os telefones de teste” e mande mensagens de um desses telefones. As
        conversas aparecem em <Link href="/atendimento" className="text-vermelho font-semibold">Atendimento</Link>.
      </p>
    </div>
  );
}
