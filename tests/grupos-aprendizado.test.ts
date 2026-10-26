/**
 * Testes da aba Grupos e do Aprendizado (sem banco e sem WhatsApp).
 * Rodar: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { grupoDaMensagem, numeroDoParticipante } from "../src/lib/atendimento/grupos";
import { ehInstanciaAprendizado, linhaDaMensagem } from "../src/lib/aprendizado/captura";
import { calcularPadroes, normalizarFrase, type MensagemCaptada } from "../src/lib/aprendizado/padroes";
import { assinar, assinarLegenda, nomeDaAssinatura } from "../src/lib/atendimento/assinatura";

const ORG = "org-1";

test("grupo: reconhece o JID do grupo e ignora conversa individual", () => {
  assert.equal(grupoDaMensagem({ remoteJid: "120363025@g.us", participant: "5519999990001@s.whatsapp.net" }), "120363025@g.us");
  assert.equal(grupoDaMensagem({ remoteJid: "abc@lid", remoteJidAlt: "120363025@g.us" }), "120363025@g.us");
  assert.equal(grupoDaMensagem({ remoteJid: "5519999990001@s.whatsapp.net" }), null);
  assert.equal(grupoDaMensagem({ remoteJid: "status@broadcast" }), null);
  assert.equal(grupoDaMensagem(undefined), null);
});

test("grupo: número de quem mandou vem do participante (também no formato novo @lid)", () => {
  assert.equal(numeroDoParticipante({ participant: "5519999990001@s.whatsapp.net" }), "5519999990001");
  assert.equal(numeroDoParticipante({ participant: "1234@lid", participantAlt: "5519999990002@s.whatsapp.net" }), "5519999990002");
  assert.equal(numeroDoParticipante({ participant: "1234@lid" }), null);
});

test("aprendizado: só a instância com o prefixo é desviada", () => {
  assert.equal(ehInstanciaAprendizado("aprendizado_ab12cd34"), true);
  assert.equal(ehInstanciaAprendizado("atendimento_ab12cd34"), false);
  assert.equal(ehInstanciaAprendizado(null), false);
});

test("aprendizado: guarda mensagem do cliente e da equipe, com direção certa", () => {
  const cliente = linhaDaMensagem(
    { key: { id: "m1", remoteJid: "5519999990001@s.whatsapp.net" }, pushName: "Bar do Zé", messageTimestamp: 1760900000, message: { conversation: "Bom dia, tem gelo?" } },
    ORG,
    "aprendizado_x",
    "ao_vivo",
  );
  assert.ok(cliente);
  assert.equal(cliente.direcao, "cliente");
  assert.equal(cliente.nome_contato, "Bar do Zé");
  assert.equal(cliente.telefone, "5519999990001");
  assert.equal(cliente.conteudo, "Bom dia, tem gelo?");
  assert.equal(cliente.enviada_em, new Date(1760900000 * 1000).toISOString());

  const equipe = linhaDaMensagem(
    { key: { id: "m2", remoteJid: "5519999990001@s.whatsapp.net", fromMe: true }, pushName: "Beba Mais", message: { extendedTextMessage: { text: "Temos sim!" } } },
    ORG,
    "aprendizado_x",
    "historico",
  );
  assert.ok(equipe);
  assert.equal(equipe.direcao, "equipe");
  assert.equal(equipe.nome_contato, null, "o nome na mensagem da equipe é o da loja, não do cliente");
  assert.equal(equipe.origem, "historico");
});

test("aprendizado: mensagem sem o JID alternativo também entra", () => {
  const l = linhaDaMensagem(
    { key: { id: "m3", remoteJid: "5519999990001@s.whatsapp.net" }, message: { conversation: "oi" } },
    ORG,
    "aprendizado_x",
    "historico",
  );
  assert.ok(l);
});

test("aprendizado: grupo, status, reação e figurinha ficam de fora", () => {
  const base = { message: { conversation: "oi" } };
  assert.equal(linhaDaMensagem({ ...base, key: { id: "g", remoteJid: "1203@g.us" } }, ORG, "a", "ao_vivo"), null);
  assert.equal(linhaDaMensagem({ ...base, key: { id: "s", remoteJid: "status@broadcast" } }, ORG, "a", "ao_vivo"), null);
  assert.equal(linhaDaMensagem({ ...base, key: { id: "n", remoteJid: "123@newsletter" } }, ORG, "a", "ao_vivo"), null);
  assert.equal(
    linhaDaMensagem({ key: { id: "r", remoteJid: "55199@s.whatsapp.net" }, message: { reactionMessage: { text: "👍" } } }, ORG, "a", "ao_vivo"),
    null,
  );
  assert.equal(
    linhaDaMensagem({ key: { id: "f", remoteJid: "55199@s.whatsapp.net" }, message: { stickerMessage: {} } }, ORG, "a", "ao_vivo"),
    null,
  );
  assert.equal(linhaDaMensagem({ ...base, key: { remoteJid: "55199@s.whatsapp.net" } }, ORG, "a", "ao_vivo"), null, "sem id não grava");
});

test("aprendizado: foto guarda a legenda e áudio fica marcado como áudio", () => {
  const foto = linhaDaMensagem(
    { key: { id: "p", remoteJid: "55199@s.whatsapp.net" }, message: { imageMessage: { caption: "comprovante", mimetype: "image/jpeg" } } },
    ORG,
    "a",
    "ao_vivo",
  );
  assert.equal(foto?.tipo, "imagem");
  assert.equal(foto?.conteudo, "comprovante");
  const audio = linhaDaMensagem(
    { key: { id: "au", remoteJid: "55199@s.whatsapp.net" }, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } },
    ORG,
    "a",
    "historico",
  );
  assert.equal(audio?.tipo, "audio");
});

test("padrões: frase escrita de jeitos diferentes conta como a mesma", () => {
  assert.equal(normalizarFrase("Bom dia!!  Tudo bem?"), "bom dia tudo bem");
  assert.equal(normalizarFrase("BOM DIA, tudo bem"), "bom dia tudo bem");
  assert.equal(normalizarFrase("Já vou gerar o seu pedido"), "ja vou gerar o seu pedido");
});

test("padrões: horário de pico, tempo de resposta e frases repetidas", () => {
  // 2026-10-20 é terça. 14h em São Paulo = 17h UTC.
  const m = (conversa: string, direcao: "cliente" | "equipe", hhmm: string, conteudo: string): MensagemCaptada => ({
    conversa_jid: conversa,
    direcao,
    tipo: "texto",
    conteudo,
    enviada_em: new Date(`2026-10-20T${hhmm}:00-03:00`).toISOString(),
  });
  const p = calcularPadroes([
    m("a", "cliente", "14:00", "Bom dia, tem gelo?"),
    m("a", "equipe", "14:02", "Bom dia! Temos sim"),
    m("b", "cliente", "14:10", "bom dia tem gelo"),
    m("b", "cliente", "14:11", "e carvão?"),
    m("b", "equipe", "14:40", "Bom dia!! Temos sim."),
    m("c", "cliente", "09:00", "Oi"),
    m("c", "equipe", "09:01", "Ok, já vou gerar o seu pedido"),
  ]);
  assert.equal(p.conversas, 3);
  assert.equal(p.porHora[14], 3);
  assert.equal(p.porHora[9], 1);
  assert.equal(p.porDia[2], 4, "terça-feira");
  // Esperas: 2 min (a), 30 min (b, conta da primeira mensagem), 1 min (c) → mediana 2.
  assert.equal(p.respostasMedidas, 3);
  assert.equal(p.respostaMedianaMin, 2);
  assert.equal(p.respondidasAte5Min, 2);
  assert.deepEqual(p.frasesEquipe.map((f) => [normalizarFrase(f.exemplo), f.vezes]), [["bom dia temos sim", 2]]);
  assert.deepEqual(p.aberturasClientes.map((f) => [normalizarFrase(f.exemplo), f.vezes]), [["bom dia tem gelo", 2]]);
});

test("padrões: sem mensagens não quebra", () => {
  const p = calcularPadroes([]);
  assert.equal(p.mensagens, 0);
  assert.equal(p.respostaMedianaMin, null);
  assert.deepEqual(p.frasesEquipe, []);
});

test("assinatura: primeiro nome em maiúsculas na primeira linha", () => {
  assert.equal(assinar("Ana Paula Souza", "Seu pedido saiu!"), "*ANA*:\nSeu pedido saiu!");
  assert.equal(assinar("  joyce ", "Oi"), "*JOYCE*:\nOi");
  assert.equal(assinar("Lúcia", "Oi"), "*LÚCIA*:\nOi");
});

test("assinatura: nome genérico ou vazio não assina", () => {
  assert.equal(assinar("Administrador", "Oi"), "Oi");
  assert.equal(assinar("Atendente", "Oi"), "Oi");
  assert.equal(assinar("", "Oi"), "Oi");
  assert.equal(assinar(null, "Oi"), "Oi");
  assert.equal(nomeDaAssinatura("*Ana*"), "ANA", "asterisco no nome não quebra o negrito");
});

test("assinatura: legenda de foto, com e sem texto", () => {
  assert.equal(assinarLegenda("Ana", "comprovante"), "*ANA*:\ncomprovante");
  assert.equal(assinarLegenda("Ana", undefined), "*ANA*");
  assert.equal(assinarLegenda("Administrador", undefined), undefined);
});
