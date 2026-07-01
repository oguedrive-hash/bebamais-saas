"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "cadencia", label: "Cadência" },
  { slug: "reativacao", label: "Reativação" },
  { slug: "lembretes", label: "Lembretes de retirada" },
  { slug: "pos-venda", label: "Pós-venda" },
  { slug: "retomada", label: "Retomada" },
] as const;

export function FollowupTabsNav({ clienteId }: { clienteId: string }) {
  const pathname = usePathname();
  const base = `/admin/clientes/${clienteId}/followup`;

  return (
    <div className="border-b border-cinza-claro mb-6">
      <nav className="flex gap-1 overflow-x-auto -mb-px">
        {TABS.map((t) => {
          const href = `${base}/${t.slug}`;
          const ativo = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={t.slug}
              href={href}
              className={`px-4 py-2.5 text-sm font-heading font-semibold whitespace-nowrap border-b-2 transition ${
                ativo
                  ? "border-laranja text-preto"
                  : "border-transparent text-cinza-medio hover:text-preto hover:border-cinza-claro"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
