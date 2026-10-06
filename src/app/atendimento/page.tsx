import { redirect } from "next/navigation";
import {
  carregarConversa,
  listarAtendentes,
  listarClientes,
  respostasRapidas,
  usuarioAtual,
} from "@/lib/atendimento/painel";
import { Painel } from "./painel";

export const dynamic = "force-dynamic";

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const selecionado = typeof sp.c === "string" ? sp.c : null;
  const busca = typeof sp.busca === "string" ? sp.busca : null;

  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  const [clientes, conversa, atendentes, respostas] = await Promise.all([
    listarClientes(busca),
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
    />
  );
}
