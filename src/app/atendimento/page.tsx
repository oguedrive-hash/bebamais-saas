import { redirect } from "next/navigation";
import {
  carregarConversa,
  carregarGrupo,
  listarAtendentes,
  listarClientes,
  listarGrupos,
  listarTodas,
  numerosDesconectados,
  respostasRapidas,
  usuarioAtual,
} from "@/lib/atendimento/painel";
import { Painel, type Aba } from "./painel";

export const dynamic = "force-dynamic";

/** Quantas conversas a aba "Todas" mostra por vez ("Carregar mais" soma outro tanto). */
const PAGINA_TODAS = 50;

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const busca = typeof sp.busca === "string" ? sp.busca : null;
  const aba: Aba = sp.aba === "todas" ? "todas" : sp.aba === "grupos" ? "grupos" : "agora";
  // Na aba Grupos o que abre é um grupo (g); nas outras, um cliente (c).
  const grupoAberto = aba === "grupos" && !busca && typeof sp.g === "string" ? sp.g : null;
  const selecionado = !grupoAberto && typeof sp.c === "string" ? sp.c : null;
  const limite = Math.min(Math.max(Number(sp.limite) || PAGINA_TODAS, PAGINA_TODAS), 1000);

  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  // Fora da aba "Todas", a lista de clientes é a de agora: mesmo na aba Grupos ela
  // carrega, para o aviso sonoro de cliente esperando continuar funcionando.
  const lista = busca || aba !== "todas"
    ? listarClientes(busca).then((clientes) => ({ clientes, temMais: false }))
    : listarTodas(limite);

  const [{ clientes, temMais }, conversa, grupos, grupo, caidos, atendentes, respostas] = await Promise.all([
    lista,
    selecionado ? carregarConversa(selecionado) : Promise.resolve(null),
    listarGrupos(),
    grupoAberto ? carregarGrupo(grupoAberto) : Promise.resolve(null),
    numerosDesconectados(),
    listarAtendentes(usuario.orgId),
    respostasRapidas(usuario.orgId),
  ]);

  return (
    <Painel
      usuario={{ id: usuario.id, nome: usuario.nome, admin: usuario.role === "admin" }}
      orgId={usuario.orgId}
      clientes={clientes}
      conversa={conversa}
      grupos={grupos}
      grupoAberto={grupo}
      numerosCaidos={caidos}
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
