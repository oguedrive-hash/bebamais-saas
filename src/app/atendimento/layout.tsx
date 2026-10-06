import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import { Logo } from "@/components/logo";
import { usuarioAtual } from "@/lib/atendimento/painel";

export default async function AtendimentoLayout({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  return (
    <div className="h-screen flex flex-col bg-offwhite">
      <header className="bg-white border-b border-cinza-claro shrink-0">
        <div className="px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="hidden sm:inline text-lg font-heading font-semibold text-preto">Atendimento</span>
          </div>
          <div className="flex items-center gap-5">
            {usuario.role === "admin" && (
              <Link href="/admin" className="text-sm font-heading font-medium text-cinza-medio hover:text-vermelho">
                Configurações
              </Link>
            )}
            <span className="text-sm font-heading font-semibold text-preto">{usuario.nome}</span>
            <form action={logoutAction}>
              <button type="submit" className="text-sm text-cinza-medio hover:text-vermelho font-heading font-medium">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}
