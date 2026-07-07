import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/login/actions";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, role")
    .eq("id", user.id)
    .single();

  // Bloqueia acesso de quem não é admin
  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  // Single-tenant: a org única vem do env (mesma fonte do resto do clone).
  // Sem ela (dev mal configurado), os links caem no /admin, que resolve sozinho.
  const orgId = process.env.DEFAULT_ORG_ID ?? "";
  const cfg = (sub: string) =>
    orgId ? `/admin/clientes/${orgId}/${sub}` : "/admin";

  return (
    <div className="min-h-screen bg-offwhite">
      {/* Header com banner admin */}
      <div className="bg-preto text-white">
        <div className="max-w-7xl mx-auto px-6 py-1.5 text-center text-xs font-heading font-medium">
          🛡 Modo Administrador
        </div>
      </div>

      <header className="bg-white border-b border-cinza-claro sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <Link href="/admin">
              <Logo />
            </Link>
            <nav className="hidden md:flex items-center gap-7">
              {/* Single-tenant (Beba Mais): links DIRETOS pra config da org
                  única — sem hub "cliente" no meio. "Métricas globais"
                  (multi-cliente da Facilita) foi removida. */}
              <NavLink href={cfg("caio")}>Atendente</NavLink>
              <NavLink href={cfg("followup")}>Follow-up</NavLink>
              <NavLink href={cfg("numeros")}>Números</NavLink>
              <NavLink href={cfg("usuarios")}>Usuários</NavLink>
              <NavLink href={cfg("editar")}>Empresa</NavLink>
              <Link
                href="/dashboard"
                className="text-sm font-heading font-medium text-cinza-medio hover:text-preto transition"
              >
                ← Painel do cliente
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-heading font-semibold text-preto">
                {profile?.nome ?? user.email}
              </p>
              <p className="text-xs text-laranja font-heading font-semibold">
                Administrador
              </p>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-sm text-cinza-medio hover:text-laranja font-heading font-medium transition"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
