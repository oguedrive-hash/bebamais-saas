import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/login/actions";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import {
  SinoHandoff,
  type LeadHandoff,
  type LeadAguardando,
} from "@/components/sino-handoff";

export default async function DashboardLayout({
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
    .select("nome, role, organization_id, organizations(name)")
    .eq("id", user.id)
    .single();

  type OrgRef = { name?: string } | { name?: string }[] | null;
  const orgRef = profile?.organizations as OrgRef;
  const orgName = Array.isArray(orgRef) ? orgRef[0]?.name : orgRef?.name;

  // Notificacoes do sino: leads com handoff disparado (precisa_humano)
  // + leads com Caio desligado e msg nova nao respondida (precisa_resposta_humana).
  // RLS filtra pela org do operador.
  const [
    { count: precisaHumanoCount },
    { data: leadsHandoffData },
    { count: aguardandoCount },
    { data: leadsAguardandoData },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("precisa_humano", true),
    supabase
      .from("leads")
      .select("id, nome, telefone, precisa_humano_motivo, precisa_humano_em")
      .eq("precisa_humano", true)
      .order("precisa_humano_em", { ascending: false })
      .limit(10),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("precisa_resposta_humana", true),
    supabase
      .from("leads")
      .select("id, nome, telefone, precisa_resposta_em")
      .eq("precisa_resposta_humana", true)
      .order("precisa_resposta_em", { ascending: false })
      .limit(10),
  ]);
  const leadsHandoff: LeadHandoff[] = leadsHandoffData ?? [];
  const leadsAguardando: LeadAguardando[] = leadsAguardandoData ?? [];

  return (
    <div className="min-h-screen bg-offwhite">
      {/* Header */}
      <header className="bg-white border-b border-cinza-claro sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <Link href="/dashboard">
              <Logo />
            </Link>
            <nav className="hidden md:flex items-center gap-7">
              <NavLink href="/dashboard" exact>
                Dashboard
              </NavLink>
              <NavLink href="/dashboard/pedidos">Pedidos</NavLink>
              <NavLink href="/dashboard/contatos">Conversas</NavLink>
              <NavLink href="/dashboard/agenda">Retiradas</NavLink>
              {/* Inbound (/dashboard/leads) e Prospecção (/dashboard/prospeccao)
                  saíram do menu no contexto Beba Mais (foco em pedidos inbound)
                  — as rotas continuam acessíveis por URL. */}
              {profile?.role === "admin" && (
                <NavLink href="/admin" variant="admin">
                  Admin
                </NavLink>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <SinoHandoff
              leads={leadsHandoff}
              total={precisaHumanoCount ?? 0}
              leadsAguardando={leadsAguardando}
              totalAguardando={aguardandoCount ?? 0}
            />
            <div className="text-right">
              <p className="text-sm font-heading font-semibold text-preto">
                {profile?.nome ?? user.email}
              </p>
              <p className="text-xs text-cinza-medio">
                {orgName ?? (profile?.role === "admin" ? "Administrador" : "Sem organização")}
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

