"use client";

import { useState, useTransition } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await loginAction(formData);
          if (result?.error) {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-5"
    >
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-heading font-semibold text-preto mb-1.5"
        >
          Usuário
        </label>
        <input
          id="email"
          name="email"
          type="text"
          required
          autoComplete="username"
          className="w-full px-4 py-3 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:ring-2 focus:ring-laranja focus:border-transparent transition"
          placeholder="seu.usuario"
        />
      </div>

      <div>
        <label
          htmlFor="senha"
          className="block text-sm font-heading font-semibold text-preto mb-1.5"
        >
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          autoComplete="current-password"
          className="w-full px-4 py-3 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:ring-2 focus:ring-laranja focus:border-transparent transition"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-3 px-4 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja-claro text-white font-heading font-semibold transition-colors"
      >
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
