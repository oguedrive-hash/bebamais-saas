import { BotaoRetranscrever } from "./botao-retranscrever";
import { AcoesShadow } from "./acoes-shadow";
import { BalaoDigitando } from "./balao-digitando";
import { ScrollToBottom } from "./scroll-to-bottom";

type Mensagem = {
  id: string;
  conteudo: string | null;
  tipo: "texto" | "audio" | "imagem" | "video" | "arquivo";
  attachment_url: string | null;
  direcao: "entrada" | "saida";
  remetente_nome: string | null;
  created_at: string;
  shadow?: boolean;
  falha_envio?: boolean;
};

export function TimelineMensagens({
  mensagens,
  caioProcessingSince = null,
}: {
  mensagens: Mensagem[];
  caioProcessingSince?: string | null;
}) {
  if (mensagens.length === 0 && !caioProcessingSince) {
    return (
      <p className="text-sm text-cinza-medio text-center py-8">
        Nenhuma mensagem ainda. Quando o lead conversar, as mensagens aparecem
        aqui.
      </p>
    );
  }

  // Trigger inclui processingSince pra rolar tambem quando "digitando" aparece
  const trigger = `${mensagens.length}-${caioProcessingSince ?? ""}`;

  return (
    <ScrollToBottom
      trigger={trigger}
      className="space-y-3 max-h-[calc(100vh-360px)] min-h-[320px] overflow-y-auto pr-2"
    >
      {mensagens.map((m) => (
        <Balao key={m.id} mensagem={m} />
      ))}
      <BalaoDigitando processingSince={caioProcessingSince} />
    </ScrollToBottom>
  );
}

function Balao({ mensagem }: { mensagem: Mensagem }) {
  const entrada = mensagem.direcao === "entrada";
  const isShadow = mensagem.shadow === true;

  const falhou = mensagem.falha_envio === true;

  let bubbleClasses: string;
  if (isShadow) {
    // Shadow: cinza/tracejado, fica claro que NÃO foi enviado
    bubbleClasses =
      "bg-white border-2 border-dashed border-cinza-medio text-preto";
  } else if (falhou) {
    // Rejeitada pelo WhatsApp após o envio (reconciliação) — o cliente NÃO recebeu
    bubbleClasses = "bg-red-50 border-2 border-red-300 text-preto";
  } else if (entrada) {
    bubbleClasses = "bg-offwhite border border-cinza-claro text-preto";
  } else {
    bubbleClasses = "bg-laranja text-white";
  }

  return (
    <div className={`flex ${entrada ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${bubbleClasses}`}>
        {isShadow && (
          <p className="text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
            Sugestão da IA (não enviada)
          </p>
        )}
        {falhou && (
          <p className="text-[10px] font-heading font-bold text-red-700 uppercase tracking-wider mb-1">
            ⚠ Não entregue — o cliente não recebeu
          </p>
        )}
        <ConteudoMensagem mensagem={mensagem} />
        <p
          className={`text-[10px] mt-1 ${
            !entrada && !isShadow ? "text-white/70" : "text-cinza-medio"
          }`}
        >
          {new Date(mensagem.created_at).toLocaleString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
          })}
        </p>
        {isShadow && <AcoesShadow mensagemId={mensagem.id} />}
      </div>
    </div>
  );
}

function ConteudoMensagem({ mensagem }: { mensagem: Mensagem }) {
  if (mensagem.tipo === "audio") {
    return (
      <div>
        <p className="text-xs font-heading font-semibold mb-1">Áudio</p>
        {mensagem.attachment_url && (
          <audio controls src={mensagem.attachment_url} className="max-w-full" />
        )}
        {mensagem.conteudo ? (
          <p className="text-sm mt-1 italic opacity-80">
            &ldquo;{mensagem.conteudo}&rdquo;
          </p>
        ) : (
          <p className="text-xs mt-1 italic opacity-60">
            Sem transcrição
          </p>
        )}
        <BotaoRetranscrever
          mensagemId={mensagem.id}
          temConteudo={Boolean(mensagem.conteudo)}
        />
      </div>
    );
  }

  if (mensagem.tipo === "imagem" && mensagem.attachment_url) {
    return (
      <div>
        <picture>
          <img
            src={mensagem.attachment_url}
            alt="Imagem enviada pelo lead"
            className="max-w-full rounded-lg"
          />
        </picture>
        {mensagem.conteudo && (
          <p className="text-sm mt-2">{mensagem.conteudo}</p>
        )}
      </div>
    );
  }

  if (mensagem.tipo === "video" && mensagem.attachment_url) {
    return (
      <div>
        <video controls src={mensagem.attachment_url} className="max-w-full rounded-lg" />
        {mensagem.conteudo && (
          <p className="text-sm mt-2">{mensagem.conteudo}</p>
        )}
      </div>
    );
  }

  if (mensagem.tipo === "arquivo") {
    return (
      <div>
        <p className="text-xs font-heading font-semibold mb-1">📎 Arquivo</p>
        {mensagem.attachment_url && (
          <a
            href={mensagem.attachment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline"
          >
            Abrir arquivo
          </a>
        )}
      </div>
    );
  }

  return (
    <p className="text-sm whitespace-pre-wrap break-words">
      {mensagem.conteudo ?? <em className="opacity-60">(sem conteúdo)</em>}
    </p>
  );
}
