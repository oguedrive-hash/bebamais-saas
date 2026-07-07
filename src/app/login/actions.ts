"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioParaEmail } from "@/lib/usuarios";

export async function loginAction(formData: FormData) {
  const supabase = await createClient();

  const usuario = (formData.get("email") as string)?.trim() ?? "";
  const senha = formData.get("senha") as string;

  // Login por USUÁRIO: quem digita "maria" vira maria@<domínio interno> por
  // baixo (Supabase Auth exige e-mail). E-mail completo continua aceito
  // (contas antigas, ex: admin).
  const email = usuario.includes("@") ? usuario : usuarioParaEmail(usuario);
  if (!email) return { error: "Informe o usuário" };

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    // Mensagem amigável — "Invalid login credentials" cru confunde
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Usuário ou senha incorretos" };
    }
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
