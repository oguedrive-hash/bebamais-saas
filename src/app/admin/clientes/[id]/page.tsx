import { redirect } from "next/navigation";

/** Página antiga de detalhes do cliente: agora leva para os primeiros passos. */
export default async function ClienteDetalhePage() {
  redirect("/admin");
}
