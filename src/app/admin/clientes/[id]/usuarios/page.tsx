import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { emailParaUsuario } from "@/lib/usuarios";
import { GestaoUsuarios, type UsuarioRow } from "./gestao-usuarios";

/**
 * Admin → Usuários: quem acessa o painel da Beba Mais.
 * Login por usuário/senha (o e-mail sintético do Auth fica invisível).
 * O gate de admin é o layout do /admin; as actions revalidam por conta.
 */

export default async function UsuariosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;
  const admin = createAdminClient();

  const [{ data: profiles }, { data: authList }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, nome, role, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const emailPorId = new Map(
    (authList?.users ?? []).map((u) => [u.id, u.email ?? null]),
  );

  const usuarios: UsuarioRow[] = (profiles ?? []).map((p) => {
    const email = emailPorId.get(p.id) ?? null;
    return {
      id: p.id,
      nome: p.nome ?? "—",
      usuario: emailParaUsuario(email) ?? email ?? "—",
      role: p.role === "admin" ? "admin" : "client",
      created_at: p.created_at,
    };
  });

  return (
    <div>
      <div className="mb-4">
        <PageHeader
          titulo="Usuários do painel"
          descricao="Quem da equipe acessa o sistema — login por usuário e senha"
        />
      </div>
      <GestaoUsuarios usuarios={usuarios} organizationId={orgId} />
    </div>
  );
}
