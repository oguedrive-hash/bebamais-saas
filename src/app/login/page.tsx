import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/logo";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/atendimento");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-offwhite p-8 relative overflow-hidden">
      {/* Forma decorativa (canto superior direito — F estilizado em laranja translúcido) */}
      <div className="absolute top-0 right-0 w-96 h-96 opacity-10 pointer-events-none">
        <div className="w-full h-full bg-laranja transform rotate-12 translate-x-32 -translate-y-32" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <Logo />
          </div>
          <h1 className="text-3xl font-heading font-bold tracking-tight text-preto mb-2">
            Bem-vindo de volta
          </h1>
          <p className="text-sm text-cinza-medio">
            Entre com suas credenciais pra acessar o painel
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-cinza-claro p-8">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-cinza-medio">
          Não tem acesso?{" "}
          <a
            href="https://facilitaplus.com.br"
            className="text-laranja font-semibold hover:underline"
          >
            Fale com a gente
          </a>
        </p>
      </div>
    </main>
  );
}
