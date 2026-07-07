"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarUsuario, resetarSenha, removerUsuario } from "./actions";

export type UsuarioRow = {
  id: string;
  nome: string;
  usuario: string;
  role: "admin" | "client";
  created_at: string;
};

function senhaAleatoria(): string {
  // Legível pra ditar por telefone: consoante+vogal alternadas + 2 dígitos
  const cons = "bcdfghjkmnpqrstvz";
  const vog = "aeiou";
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += cons[Math.floor(Math.random() * cons.length)];
    s += vog[Math.floor(Math.random() * vog.length)];
  }
  return s + String(Math.floor(10 + Math.random() * 90));
}

export function GestaoUsuarios({
  usuarios,
  organizationId,
}: {
  usuarios: UsuarioRow[];
  organizationId: string;
}) {
  const router = useRouter();
  const [modalNovo, setModalNovo] = useState(false);
  const [resetando, setResetando] = useState<UsuarioRow | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remover(u: UsuarioRow) {
    if (
      !window.confirm(
        `Remover o acesso de "${u.nome}" (${u.usuario})? A pessoa não consegue mais entrar no painel.`,
      )
    )
      return;
    setErro(null);
    startTransition(async () => {
      try {
        const r = await removerUsuario({ userId: u.id, organizationId });
        if ("error" in r) {
          setErro(r.error);
          return;
        }
        setSucesso(`Acesso de ${u.nome} removido.`);
        router.refresh();
      } catch {
        setErro("Falha de conexão — tente de novo.");
      }
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-cinza-medio">
          {usuarios.length} usuário{usuarios.length !== 1 ? "s" : ""} com acesso
        </p>
        <button
          type="button"
          onClick={() => {
            setSucesso(null);
            setModalNovo(true);
          }}
          className="px-4 py-2.5 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold transition"
        >
          + Novo usuário
        </button>
      </div>

      {sucesso && (
        <p className="mb-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {sucesso}
        </p>
      )}
      {erro && (
        <p className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {erro}
        </p>
      )}

      <div className="bg-white rounded-2xl border border-cinza-claro overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-offwhite border-b border-cinza-claro text-left text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr
                key={u.id}
                className="border-b border-cinza-claro last:border-0"
              >
                <td className="px-4 py-2.5 font-heading font-semibold text-preto">
                  {u.nome}
                </td>
                <td className="px-4 py-2.5 font-mono text-preto">{u.usuario}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-heading font-semibold border ${
                      u.role === "admin"
                        ? "bg-laranja/10 text-laranja-escuro border-laranja/40"
                        : "bg-offwhite text-cinza-medio border-cinza-claro"
                    }`}
                  >
                    {u.role === "admin" ? "Administrador" : "Atendente"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      setSucesso(null);
                      setResetando(u);
                    }}
                    disabled={pending}
                    className="text-xs text-cinza-medio hover:text-preto font-heading font-semibold mr-3 disabled:opacity-50"
                  >
                    Resetar senha
                  </button>
                  <button
                    type="button"
                    onClick={() => remover(u)}
                    disabled={pending}
                    className="text-xs text-red-600 hover:text-red-700 font-heading font-semibold disabled:opacity-50"
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-cinza-medio">
                  Nenhum usuário ainda — crie o primeiro acesso da equipe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalNovo && (
        <NovoUsuarioModal
          organizationId={organizationId}
          onFechar={() => setModalNovo(false)}
          onCriado={(msg) => {
            setModalNovo(false);
            setSucesso(msg);
            router.refresh();
          }}
        />
      )}
      {resetando && (
        <ResetSenhaModal
          usuario={resetando}
          onFechar={() => setResetando(null)}
          onOk={(msg) => {
            setResetando(null);
            setSucesso(msg);
          }}
        />
      )}
    </div>
  );
}

function NovoUsuarioModal({
  organizationId,
  onFechar,
  onCriado,
}: {
  organizationId: string;
  onFechar: () => void;
  onCriado: (msg: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState(senhaAleatoria());
  const [role, setRole] = useState<"client" | "admin">("client");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    if (pending) return;
    setErro(null);
    startTransition(async () => {
      try {
        const r = await criarUsuario({
          nome,
          usuario,
          senha,
          role,
          organizationId,
        });
        if ("error" in r) {
          setErro(r.error);
          return;
        }
        onCriado(
          `Usuário criado! Anote e repasse: usuário "${r.usuario}" · senha "${senha}"`,
        );
      } catch {
        setErro("Falha de conexão — tente de novo.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-preto/40 flex items-center justify-center p-4"
      onClick={() => !pending && onFechar()}
    >
      <div
        className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-heading font-bold text-preto mb-4">
          Novo usuário
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Nome
            </label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="ex: Maria Silva"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm focus:outline-none focus:border-laranja transition"
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Usuário (pra entrar no sistema)
            </label>
            <input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value.toLowerCase())}
              placeholder="ex: maria.silva"
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro font-mono text-sm focus:outline-none focus:border-laranja transition"
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Senha (gerada — pode trocar)
            </label>
            <div className="flex gap-2">
              <input
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg border border-cinza-claro font-mono text-sm focus:outline-none focus:border-laranja transition"
              />
              <button
                type="button"
                onClick={() => setSenha(senhaAleatoria())}
                title="Gerar outra"
                className="px-3 py-2.5 rounded-lg border border-cinza-claro text-sm hover:border-laranja transition"
              >
                🎲
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Papel
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "client" | "admin")}
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm bg-white focus:outline-none focus:border-laranja transition"
            >
              <option value="client">Atendente (usa o painel)</option>
              <option value="admin">Administrador (configura tudo)</option>
            </select>
          </div>
          {erro && (
            <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onFechar}
              disabled={pending}
              className="px-4 py-2 rounded-lg border border-cinza-claro text-sm font-heading font-semibold text-cinza-medio hover:text-preto transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={pending || !nome.trim() || !usuario.trim()}
              className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold disabled:opacity-50 transition"
            >
              {pending ? "Criando..." : "Criar usuário"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResetSenhaModal({
  usuario,
  onFechar,
  onOk,
}: {
  usuario: UsuarioRow;
  onFechar: () => void;
  onOk: (msg: string) => void;
}) {
  const [senha, setSenha] = useState(senhaAleatoria());
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    if (pending) return;
    setErro(null);
    startTransition(async () => {
      try {
        const r = await resetarSenha({ userId: usuario.id, novaSenha: senha });
        if ("error" in r) {
          setErro(r.error);
          return;
        }
        onOk(
          `Senha de ${usuario.nome} trocada! Anote e repasse: "${senha}"`,
        );
      } catch {
        setErro("Falha de conexão — tente de novo.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-preto/40 flex items-center justify-center p-4"
      onClick={() => !pending && onFechar()}
    >
      <div
        className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-heading font-bold text-preto mb-1">
          Resetar senha
        </h2>
        <p className="text-sm text-cinza-medio mb-4">
          {usuario.nome} ({usuario.usuario})
        </p>
        <div className="flex gap-2 mb-4">
          <input
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-lg border border-cinza-claro font-mono text-sm focus:outline-none focus:border-laranja transition"
          />
          <button
            type="button"
            onClick={() => setSenha(senhaAleatoria())}
            title="Gerar outra"
            className="px-3 py-2.5 rounded-lg border border-cinza-claro text-sm hover:border-laranja transition"
          >
            🎲
          </button>
        </div>
        {erro && (
          <p className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {erro}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={pending}
            className="px-4 py-2 rounded-lg border border-cinza-claro text-sm font-heading font-semibold text-cinza-medio hover:text-preto transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pending || senha.length < 8}
            className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold disabled:opacity-50 transition"
          >
            {pending ? "Trocando..." : "Trocar senha"}
          </button>
        </div>
      </div>
    </div>
  );
}
