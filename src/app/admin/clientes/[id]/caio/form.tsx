"use client";

import { useState, useTransition } from "react";
import { salvarCaioConfig } from "./actions";

export function CaioForm({
  organizationId,
  comportamentoInbound: inboundInicial,
  comportamentoProspeccao: prospeccaoInicial,
  baseConhecimento: baseInicial,
}: {
  organizationId: string;
  comportamentoInbound: string;
  comportamentoProspeccao: string;
  baseConhecimento: string;
}) {
  const [inbound, setInbound] = useState(inboundInicial);
  const [prospeccao, setProspeccao] = useState(prospeccaoInicial);
  const [base, setBase] = useState(baseInicial);
  const [pending, startTransition] = useTransition();
  const [salvouAgora, setSalvouAgora] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function salvarTudo() {
    setErro(null);
    startTransition(async () => {
      const result = await salvarCaioConfig(organizationId, {
        comportamentoInbound: inbound,
        comportamentoProspeccao: prospeccao,
        baseConhecimento: base,
      });
      if ("error" in result) {
        setErro(result.error);
      } else {
        setSalvouAgora(true);
        setTimeout(() => setSalvouAgora(false), 3000);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Card 1: Comportamento Inbound */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <div className="mb-3">
          <h3 className="text-base font-heading font-bold text-preto">
            Comportamento — Inbound
          </h3>
          <p className="text-xs text-cinza-medio mt-1">
            Como o atendente age quando o cliente procura a gente primeiro. Foco em
            tirar dúvidas e induzir o fechamento do pedido e o agendamento da
            retirada. Aqui vai{" "}
            <strong>só comportamento</strong>: identidade, tom de voz, regras,
            o que pode/não pode fazer. As informações da empresa ficam na{" "}
            <em>Base de Conhecimento</em> abaixo.
          </p>
        </div>
        <textarea
          rows={12}
          value={inbound}
          onChange={(e) => setInbound(e.target.value)}
          placeholder={"Você é o atendente virtual da Beba Mais (distribuidora de bebidas).\n\nSeu objetivo: entender o que o cliente precisa, montar o pedido e combinar a retirada na loja ou a entrega.\n\nO que fazer:\n- Cumprimentar de forma calorosa\n- Fazer 1-2 perguntas pra entender o pedido antes de fechar\n- ...\n\nO que NÃO fazer:\n- Inventar info que não está na base\n- ..."}
          className="w-full px-4 py-3 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition font-mono text-xs leading-relaxed"
        />
      </section>

      {/* Card 2: Comportamento Prospecção */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <div className="mb-3">
          <h3 className="text-base font-heading font-bold text-preto">
            Comportamento — Prospecção
          </h3>
          <p className="text-xs text-cinza-medio mt-1">
            Como o atendente age quando VOCÊ iniciou o contato (lead nunca falou
            antes). Foco em fazer perguntas sobre a empresa do lead e explicar
            como o nosso trabalho funciona. Tom diferente do inbound — não
            agradece por &quot;ter entrado em contato&quot;.
          </p>
        </div>
        <textarea
          rows={12}
          value={prospeccao}
          onChange={(e) => setProspeccao(e.target.value)}
          placeholder={"Você é o atendente virtual da empresa. Você está prospectando ativamente.\n\nSeu objetivo: descobrir como a empresa do lead funciona e mostrar como nosso trabalho pode ajudar.\n\nComo abrir uma conversa:\n- Sem dizer 'obrigado por entrar em contato'\n- Apresentar-se brevemente e fazer pergunta exploratória\n\nO que perguntar:\n- Como funciona o setor de... na empresa dele?\n- Quantos leads/clientes/etc.\n\n..."}
          className="w-full px-4 py-3 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition font-mono text-xs leading-relaxed"
        />
      </section>

      {/* Card 3: Base de Conhecimento */}
      <section className="bg-white rounded-2xl border border-cinza-claro p-6">
        <div className="mb-3">
          <h3 className="text-base font-heading font-bold text-preto">
            Base de Conhecimento
          </h3>
          <p className="text-xs text-cinza-medio mt-1">
            Tudo que o atendente precisa SABER sobre a empresa: produtos, serviços,
            preços, horários, processo de venda, FAQs, depoimentos, link de
            agendamento, etc. Esse conteúdo é compartilhado pelos dois
            comportamentos (inbound e prospecção) — escreve uma vez só.
          </p>
        </div>
        <textarea
          rows={20}
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder={"## Sobre a empresa\nNome: ...\nO que faz: ...\n\n## Serviços / produtos\n- Produto A — R$X, prazo Y\n- Produto B — ...\n\n## Como funciona a retirada\nEndereço: ...\nHorário: ...\n\n## FAQ\nP: ...\nR: ...\n\n..."}
          className="w-full px-4 py-3 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition font-mono text-xs leading-relaxed"
        />
      </section>

      {erro && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-cinza-claro shadow-lg">
        <p className="text-xs text-cinza-medio">
          Tudo é salvo de uma vez. Em produção, próximas respostas da IA já
          usam o novo conteúdo.
        </p>
        <div className="flex items-center gap-3">
          {salvouAgora && (
            <span className="text-sm text-green-700 font-heading font-semibold">
              ✓ Salvo
            </span>
          )}
          <button
            type="button"
            onClick={salvarTudo}
            disabled={pending}
            className="px-5 py-3 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja-claro text-white font-heading font-semibold transition"
          >
            {pending ? "Salvando..." : "Salvar configuração"}
          </button>
        </div>
      </div>
    </div>
  );
}
