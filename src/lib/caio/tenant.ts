import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_ID } from "@/lib/caio/config";
import type { ChatwootWebhook } from "./types";

/**
 * Identifica qual cliente (organization) é dono dessa conversa.
 *
 * Cada organização tem 1 `chatwoot_inbox_id` único.
 * Aceita payload de message_* (com `conversation.inbox_id`) ou de
 * conversation_* (com `inbox_id` no body raiz).
 */
export async function resolveOrganization(
  webhook: ChatwootWebhook,
): Promise<{ id: string; name: string } | null> {
  const inboxId = extractInboxId(webhook);
  if (!inboxId) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("chatwoot_inbox_id", inboxId)
    .eq("ativo", true)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Fallback temporário: enquanto o provisionamento automático não está pronto,
 * a Facilita ainda não tem `chatwoot_inbox_id` setado.
 *
 * Remover quando o provisionamento configurar o inbox_id corretamente.
 */
export async function getFacilitaOrgFallback(): Promise<{
  id: string;
  name: string;
} | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", ORG_ID)
    .single();

  if (error || !data) return null;
  return data;
}

function extractInboxId(webhook: ChatwootWebhook): number | undefined {
  // message_created/updated: conversation.inbox_id
  if (
    "conversation" in webhook &&
    webhook.conversation &&
    typeof webhook.conversation === "object" &&
    "inbox_id" in webhook.conversation
  ) {
    return (webhook.conversation as { inbox_id: number }).inbox_id;
  }
  // conversation_created/updated: inbox_id no body raiz
  if ("inbox_id" in webhook && typeof webhook.inbox_id === "number") {
    return webhook.inbox_id;
  }
  return undefined;
}
