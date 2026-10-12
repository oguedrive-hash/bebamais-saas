import { createAdminClient } from "@/lib/supabase/admin";
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

  const [{ data: profiles }, { data: authList }, { data: org }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, nome, role, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
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
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-4xl font-heading font-bold text-preto">Atendentes e acessos</h1>
        <p className="text-cinza-medio mt-2">
          Crie aqui o login de cada pessoa da equipe. Ela entra no painel pelo mesmo endereço deste sistema, com o usuário
          e a senha que você criar. Depois de criar, use “Copiar instruções” para mandar o passo a passo para ela.
        </p>
      </div>
      <GestaoUsuarios usuarios={usuarios} organizationId={orgId} empresa={org?.name?.trim() || "loja"} />
    </div>
  );
}
