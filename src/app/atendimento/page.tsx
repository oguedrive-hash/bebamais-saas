import { redirect } from "next/navigation";
import {
  carregarConversa,
  listarAtendentes,
  listarClientes,
  listarTodas,
  respostasRapidas,
  usuarioAtual,
} from "@/lib/atendimento/painel";
import { Painel } from "./painel";

export const dynamic = "force-dynamic";

/** Quantas conversas a aba "Todas" mostra por vez ("Carregar mais" soma outro tanto). */
const PAGINA_TODAS = 50;

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const selecionado = typeof sp.c === "string" ? sp.c : null;
  const busca = typeof sp.busca === "string" ? sp.busca : null;
  const aba = sp.aba === "todas" ? "todas" : "agora";
  const limite = Math.min(Math.max(Number(sp.limite) || PAGINA_TODAS, PAGINA_TODAS), 1000);

  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  const lista = busca || aba === "agora"
    ? listarClientes(busca).then((clientes) => ({ clientes, temMais: false }))
    : listarTodas(limite);

  const [{ clientes, temMais }, conversa, atendentes, respostas] = await Promise.all([
    lista,
    selecionado ? carregarConversa(selecionado) : Promise.resolve(null),
    listarAtendentes(usuario.orgId),
    respostasRapidas(usuario.orgId),
  ]);

  return (
    <Painel
      usuario={{ id: usuario.id, nome: usuario.nome, admin: usuario.role === "admin" }}
      orgId={usuario.orgId}
      clientes={clientes}
      conversa={conversa}
      atendentes={atendentes.filter((a) => a.id !== usuario.id)}
      respostasRapidas={respostas}
      busca={busca}
      aba={aba}
      limite={limite}
      temMais={temMais}
      paginaTodas={PAGINA_TODAS}
    />
  );
}
