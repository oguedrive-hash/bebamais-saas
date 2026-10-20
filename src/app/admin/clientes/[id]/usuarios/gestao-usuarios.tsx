"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarUsuario, resetarSenha, removerUsuario, trocarNome } from "./actions";
import { nomeDaAssinatura } from "@/lib/atendimento/assinatura";

export type UsuarioRow = {
  id: string;
  nome: string;
  usuario: string;
  role: "admin" | "client";
  created_at: string;
};

function senhaAleatoria(): string {
  // Legível pra ditar por telefone (consoante+vogal + 2 dígitos), com fonte
  // criptográfica — Math.random é previsível demais pra senha.
  const cons = "bcdfghjkmnpqrstvz";
  const vog = "aeiou";
  const rnd = new Uint32Array(10);
  crypto.getRandomValues(rnd);
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += cons[rnd[i * 2] % cons.length];
    s += vog[rnd[i * 2 + 1] % vog.length];
  }
  return s + String(10 + (rnd[8] % 90));
}

/** Passo a passo para mandar à pessoa (sem a senha: ela vai em outra mensagem). */
function instrucoesDeAcesso(nome: string, usuario: string, empresa: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] || "";
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Este é o seu acesso ao painel de atendimento da ${empresa}:`,
    "",
    `Endereço: ${window.location.origin}`,
    `Usuário: ${usuario}`,
    "Senha: vou te mandar em outra mensagem.",
    "",
    "Como atender:",
    "1. Entre no endereço com seu usuário e senha.",
    "2. Clientes em vermelho estão esperando: clique em um e depois em “Pegar este cliente”.",
    "3. Responda pela caixa de mensagem, como no WhatsApp.",
    "4. Quando resolver, clique em “Finalizar atendimento”.",
  ].join("\n");
}

/** `texto` pode ser uma função: só é montado no clique (usa o endereço do navegador). */
function BotaoCopiar(props: { texto: string | (() => string); rotulo: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const texto = typeof props.texto === "function" ? props.texto() : props.texto;
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2500);
        } catch {
          window.prompt("Copie o texto abaixo:", texto);
        }
      }}
      className={props.className ?? "rounded-lg border border-cinza-claro bg-white px-3 py-1.5 text-sm font-heading font-semibold hover:border-preto"}
    >
      {copiado ? "Copiado ✓" : props.rotulo}
    </button>
  );
}

/** Cartão mostrado logo depois de criar o acesso ou trocar a senha. */
function CartaoAcesso(props: { acesso: { nome: string; usuario: string; senha: string }; empresa: string; onFechar: () => void }) {
  const { acesso } = props;
  return (
    <div className="mb-4 rounded-2xl border-2 border-green-300 bg-green-50 p-5 space-y-3">
      <p className="font-heading font-bold text-green-900">Acesso de {acesso.nome} pronto. Agora mande para ela:</p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-cinza-medio">Endereço</dt>
        <dd className="font-mono">{typeof window !== "undefined" ? window.location.origin : ""}</dd>
        <dt className="text-cinza-medio">Usuário</dt>
        <dd className="font-mono">{acesso.usuario}</dd>
        <dt className="text-cinza-medio">Senha</dt>
        <dd className="font-mono">{acesso.senha}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <BotaoCopiar texto={() => instrucoesDeAcesso(acesso.nome, acesso.usuario, props.empresa)} rotulo="1. Copiar instruções (sem a senha)" />
        <BotaoCopiar texto={acesso.senha} rotulo="2. Copiar a senha" />
        <button type="button" onClick={props.onFechar} className="px-3 py-1.5 text-sm text-cinza-medio hover:text-preto">
          Fechar
        </button>
      </div>
      <p className="text-xs text-cinza-medio">
        Mande as instruções e a senha em mensagens separadas. Esta senha só aparece agora: se perder, use “Trocar senha”.
      </p>
    </div>
  );
}

export function GestaoUsuarios({
  usuarios,
  organizationId,
  empresa,
}: {
  usuarios: UsuarioRow[];
  organizationId: string;
  empresa: string;
}) {
  const router = useRouter();
  const [modalNovo, setModalNovo] = useState(false);
  const [resetando, setResetando] = useState<UsuarioRow | null>(null);
  const [renomeando, setRenomeando] = useState<UsuarioRow | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [acesso, setAcesso] = useState<{ nome: string; usuario: string; senha: string } | null>(null);
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
          {usuarios.length} {usuarios.length !== 1 ? "pessoas" : "pessoa"} com acesso
        </p>
        <button
          type="button"
          onClick={() => {
            setSucesso(null);
            setAcesso(null);
            setModalNovo(true);
          }}
          className="px-4 py-2.5 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold transition"
        >
          + Criar acesso
        </button>
      </div>

      {acesso && <CartaoAcesso acesso={acesso} empresa={empresa} onFechar={() => setAcesso(null)} />}
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
              <th className="px-4 py-3">Usuário (para entrar)</th>
              <th className="px-4 py-3">Tipo de acesso</th>
              <th className="px-4 py-3 text-right"></th>
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
                  <BotaoCopiar
                    texto={() => instrucoesDeAcesso(u.nome, u.usuario, empresa)}
                    rotulo="Copiar instruções"
                    className="text-xs text-cinza-medio hover:text-preto font-heading font-semibold mr-3"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSucesso(null);
                      setAcesso(null);
                      setRenomeando(u);
                    }}
                    disabled={pending}
                    className="text-xs text-cinza-medio hover:text-preto font-heading font-semibold mr-3 disabled:opacity-50"
                  >
                    Trocar nome
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSucesso(null);
                      setAcesso(null);
                      setResetando(u);
                    }}
                    disabled={pending}
                    className="text-xs text-cinza-medio hover:text-preto font-heading font-semibold mr-3 disabled:opacity-50"
                  >
                    Trocar senha
                  </button>
                  <button
                    type="button"
                    onClick={() => remover(u)}
                    disabled={pending}
                    className="text-xs text-red-600 hover:text-red-700 font-heading font-semibold disabled:opacity-50"
                  >
                    Remover acesso
                  </button>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-cinza-medio">
                  Ninguém da equipe tem acesso ainda. Clique em “+ Criar acesso”.
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
          onCriado={(novoAcesso) => {
            setModalNovo(false);
            setAcesso(novoAcesso);
            router.refresh();
          }}
        />
      )}
      {renomeando && (
        <TrocarNomeModal
          usuario={renomeando}
          organizationId={organizationId}
          onFechar={() => setRenomeando(null)}
          onOk={(nome) => {
            setSucesso(`Nome trocado para ${nome}.`);
            setRenomeando(null);
            router.refresh();
          }}
        />
      )}
      {resetando && (
        <ResetSenhaModal
          usuario={resetando}
          onFechar={() => setResetando(null)}
          onOk={(senha) => {
            setAcesso({ nome: resetando.nome, usuario: resetando.usuario, senha });
            setResetando(null);
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
  onCriado: (acesso: { nome: string; usuario: string; senha: string }) => void;
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
        onCriado({ nome: nome.trim(), usuario: r.usuario, senha });
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
          Criar acesso
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Nome da pessoa
            </label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="ex: Maria Silva"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm focus:outline-none focus:border-laranja transition"
            />
            <ExemploAssinatura nome={nome} />
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Usuário (o que ela digita para entrar)
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
              Senha (já vem uma sugestão; pode trocar)
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
              Tipo de acesso
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "client" | "admin")}
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm bg-white focus:outline-none focus:border-laranja transition"
            >
              <option value="client">Atendente (só atende os clientes)</option>
              <option value="admin">Administrador (também mexe nas configurações)</option>
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
              {pending ? "Criando..." : "Criar acesso"}
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
  onOk: (senha: string) => void;
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
        onOk(senha);
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
          Trocar senha
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

/** Mostra como o nome aparece para o cliente no WhatsApp. */
function ExemploAssinatura({ nome }: { nome: string }) {
  const assinatura = nomeDaAssinatura(nome);
  return (
    <p className="mt-1.5 text-xs text-cinza-medio">
      O cliente vê o primeiro nome no começo de cada mensagem dela
      {assinatura ? (
        <>
          : <span className="font-mono text-preto">*{assinatura}*:</span>
        </>
      ) : (
        "."
      )}
    </p>
  );
}

function TrocarNomeModal({
  usuario,
  organizationId,
  onFechar,
  onOk,
}: {
  usuario: UsuarioRow;
  organizationId: string;
  onFechar: () => void;
  onOk: (nome: string) => void;
}) {
  const [nome, setNome] = useState(usuario.nome === "—" ? "" : usuario.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    if (pending) return;
    setErro(null);
    startTransition(async () => {
      try {
        const r = await trocarNome({ userId: usuario.id, organizationId, nome });
        if ("error" in r) {
          setErro(r.error);
          return;
        }
        onOk(nome.trim());
      } catch {
        setErro("Falha de conexão — tente de novo.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-preto/40 flex items-center justify-center p-4" onClick={() => !pending && onFechar()}>
      <div className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-heading font-bold text-preto mb-1">Trocar nome</h2>
        <p className="text-sm text-cinza-medio mb-4">
          Usuário para entrar: <span className="font-mono">{usuario.usuario}</span> (não muda)
        </p>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && salvar()}
          placeholder="ex: Maria Silva"
          autoFocus
          className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm focus:outline-none focus:border-laranja transition"
        />
        <ExemploAssinatura nome={nome} />
        {erro && <p className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        <div className="flex items-center justify-end gap-2 mt-5">
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
            disabled={pending || !nome.trim()}
            className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold disabled:opacity-50 transition"
          >
            {pending ? "Salvando..." : "Salvar nome"}
          </button>
        </div>
      </div>
    </div>
  );
}
