import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ClienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Paraleliza pra evitar 4 round-trips sequenciais
  const [
    { data: cliente, error },
    { count: leadsCliente },
    { count: agendamentosCliente },
    { data: usuarios },
  ] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", id).single(),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    supabase
      .from("agendamentos")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    supabase
      .from("profiles")
      .select("id, nome, role, created_at")
      .eq("organization_id", id),
  ]);

  if (error || !cliente) {
    notFound();
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-white rounded-2xl border border-cinza-claro p-8 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-heading font-bold text-preto mb-1">
              {cliente.name}
            </h1>
            <p className="text-sm text-cinza-medio">{cliente.email_contato}</p>
            {cliente.whatsapp_numero && (
              <p className="text-xs text-cinza-medio font-mono mt-1">
                WhatsApp: {cliente.whatsapp_numero}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-3">
            <StatusCliente ativo={cliente.ativo} />
            <div className="flex items-center gap-3 mt-2">
              <Link
                href={`/admin/clientes/${cliente.id}/caio`}
                className="text-sm text-laranja hover:text-laranja-escuro font-heading font-semibold"
              >
                Atendente →
              </Link>
              <Link
                href={`/admin/clientes/${cliente.id}/followup`}
                className="text-sm text-laranja hover:text-laranja-escuro font-heading font-semibold"
              >
                Follow-up →
              </Link>
              <Link
                href={`/admin/clientes/${cliente.id}/numeros`}
                className="text-sm text-laranja hover:text-laranja-escuro font-heading font-semibold"
              >
                Números →
              </Link>
              <Link
                href={`/admin/clientes/${cliente.id}/editar`}
                className="text-sm text-laranja hover:text-laranja-escuro font-heading font-semibold"
              >
                Empresa →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <MetricaCard label="Leads" valor={leadsCliente ?? 0} />
        <MetricaCard label="Agendamentos" valor={agendamentosCliente ?? 0} />
        <MetricaCard label="Usuários" valor={usuarios?.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Config técnica (Chatwoot/Asaas/plano eram da operação da Facilita) */}
        <Card titulo="Configuração técnica">
          <dl className="space-y-3">
            <DataRow label="Voice ID (ElevenLabs)" valor={cliente.voice_id ?? "—"} />
            <DataRow
              label="Evolution Instance"
              valor={cliente.evolution_instance_name ?? "Não provisionado"}
            />
          </dl>
        </Card>

        {/* Status da configuração do atendente IA */}
        <Card titulo="Configuração do Atendente IA">
          <ul className="text-sm space-y-1.5">
            <li className="flex items-center gap-2">
              <span>{cliente.prompt_system ? "✓" : "✕"}</span>
              <span
                className={
                  cliente.prompt_system ? "text-preto" : "text-cinza-medio"
                }
              >
                Comportamento Inbound
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span>{cliente.prompt_system_prospeccao ? "✓" : "✕"}</span>
              <span
                className={
                  cliente.prompt_system_prospeccao
                    ? "text-preto"
                    : "text-cinza-medio"
                }
              >
                Comportamento Prospecção
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span>{cliente.base_conhecimento ? "✓" : "✕"}</span>
              <span
                className={
                  cliente.base_conhecimento ? "text-preto" : "text-cinza-medio"
                }
              >
                Base de Conhecimento
              </span>
            </li>
          </ul>
          <Link
            href={`/admin/clientes/${cliente.id}/caio`}
            className="text-sm text-laranja hover:text-laranja-escuro font-heading font-semibold mt-3 inline-block"
          >
            Editar →
          </Link>
        </Card>
      </div>

      {/* Usuários do cliente */}
      <div className="mt-6 bg-white rounded-2xl border border-cinza-claro p-6">
        <h2 className="text-lg font-heading font-bold text-preto mb-4">
          Usuários vinculados
        </h2>
        {!usuarios || usuarios.length === 0 ? (
          <p className="text-sm text-cinza-medio">
            Nenhum usuário cadastrado ainda nessa organização.
          </p>
        ) : (
          <table className="w-full">
            <thead className="border-b border-cinza-claro">
              <tr>
                <th className="text-left py-2 text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
                  Nome
                </th>
                <th className="text-left py-2 text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
                  Role
                </th>
                <th className="text-left py-2 text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
                  Criado em
                </th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-b border-cinza-claro last:border-0">
                  <td className="py-3 text-sm text-preto">{u.nome ?? "—"}</td>
                  <td className="py-3 text-sm text-cinza-medio">{u.role}</td>
                  <td className="py-3 text-sm text-cinza-medio">
                    {new Date(u.created_at).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* "Gerenciar cliente" (pausar/excluir a org) removido — no single-tenant
          da Beba Mais excluir a própria org derrubaria o sistema inteiro. */}
    </div>
  );
}

function MetricaCard({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="bg-white rounded-2xl border border-cinza-claro p-5">
      <p className="text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-3xl font-heading font-bold text-preto">{valor}</p>
    </div>
  );
}

function Card({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-cinza-claro p-6">
      <h2 className="text-lg font-heading font-bold text-preto mb-4">
        {titulo}
      </h2>
      {children}
    </div>
  );
}

function DataRow({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-preto font-mono break-all">{valor}</dd>
    </div>
  );
}

function StatusCliente({ ativo }: { ativo: boolean }) {
  if (!ativo) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-semibold bg-cinza-claro text-cinza-medio border border-cinza-claro">
        Pausado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-700" />
      Ativo
    </span>
  );
}

