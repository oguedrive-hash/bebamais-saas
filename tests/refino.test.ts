/**
 * Travas do refinamento de 23/10 (aprendidas nas conversas reais), sem IA.
 * Rodar: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarTravas,
  avisarLojaFechada,
  ehComprovante,
  perguntaDoPedido,
  semAtendenteRepetida,
  soFotoSemTexto,
  type ContextoTravas,
} from "../src/lib/atendimento/assistente";
import { ehContatoInterno, mesmoTelefone, normalizarConfig } from "../src/lib/atendimento/regras";

const aberto: ContextoTravas = { respostasJaDadas: 0, aberto: true, saudacao: "boa tarde" };
const fechado: ContextoTravas = { respostasJaDadas: 0, aberto: false, saudacao: "boa noite", proximaAbertura: "amanhã às 08:00" };

test("comprovante: arquivo e frases de quem já pagou", () => {
  assert.equal(ehComprovante("[enviou um arquivo: Comprovante.pdf]"), true);
  assert.equal(ehComprovante("[enviou um arquivo: PIX - BEBA MAIS - 21-10.pdf]"), true);
  assert.equal(ehComprovante("[enviou uma foto] comprovante"), true);
  assert.equal(ehComprovante("Ta pago"), true);
  assert.equal(ehComprovante("segue o pix"), true);
  assert.equal(ehComprovante("já fiz o pix"), true);
  assert.equal(ehComprovante("Segue o pagamento da água"), true);
});

test("comprovante: não confunde com quem ainda vai pagar ou com pedido", () => {
  assert.equal(ehComprovante("vou fazer o pix"), false);
  assert.equal(ehComprovante("Me envia o pix por gentileza?"), false);
  assert.equal(ehComprovante("Já mandei o pedido ontem"), false);
  assert.equal(ehComprovante("[enviou um arquivo: pedido_restaurante.xlsx]"), false);
  assert.equal(ehComprovante("o boleto tá pago?"), false);
  assert.equal(ehComprovante("[enviou uma foto] segue o pedido da semana"), false);
});

test("comprovante: resposta agradece e passa, nunca fala de pedido ou nota", () => {
  const d = aplicarTravas({ resposta: "Vamos verificar a sua nota fiscal.", assunto: "pos_venda", passar: true }, {
    ...fechado,
    textoCliente: "[enviou um arquivo: Comprovante.pdf]",
  });
  assert.equal(d.assunto, "pos_venda");
  assert.equal(d.passar, true);
  assert.match(d.resposta, /comprovante/);
  assert.match(d.resposta, /assim que a loja abrir/);
  assert.doesNotMatch(d.resposta, /nota fiscal|pedido|já confere/);
});

test("foto sem texto: não chuta que é pedido", () => {
  assert.equal(soFotoSemTexto("Boa tarde\n[enviou uma foto]"), true);
  assert.equal(soFotoSemTexto("[enviou uma foto]"), true);
  assert.equal(soFotoSemTexto("[enviou uma foto] segue o pedido da semana"), false);
  assert.equal(soFotoSemTexto("2 galões de 20"), false);
  const d = aplicarTravas({ resposta: "Recebemos seu pedido.", assunto: "pedido", passar: true }, {
    ...aberto,
    textoCliente: "Boa tarde\n[enviou uma foto]",
  });
  assert.match(d.resposta, /Recebemos a sua foto/);
  assert.doesNotMatch(d.resposta, /pedido/);
  assert.equal(d.passar, true);
});

test("loja fechada: avisa e não promete 'já vai'", () => {
  const r = avisarLojaFechada("Olá, boa noite! Recebemos seu pedido. Uma atendente já vai gerar e te mandar para conferir.", "amanhã às 08:00");
  assert.equal(
    r,
    "Olá, boa noite! Recebemos seu pedido. Estamos fechados agora e abrimos amanhã às 08:00. Uma atendente vai gerar e te mandar para conferir assim que a loja abrir.",
  );
  // Se a IA já avisou certinho, não mexe.
  const certo = "Olá, boa noite! Recebemos seu pedido! Estamos fechados agora e abrimos amanhã às 08:00; uma atendente gera o seu pedido assim que a loja abrir. É para entrega ou retirada?";
  assert.equal(avisarLojaFechada(certo, "amanhã às 08:00"), certo);
});

test("loja fechada: pedido passado pela IA sai com o aviso", () => {
  const d = aplicarTravas({ resposta: "Olá, boa noite! Recebemos seu pedido. Uma atendente já vai gerar e te mandar para conferir.", assunto: "pedido", passar: true }, {
    ...fechado,
    textoCliente: "Pedido 1 Skol 600 1 Heineken 600",
  });
  assert.match(d.resposta, /fechados agora e abrimos amanhã às 08:00/);
  assert.doesNotMatch(d.resposta, /já vai/);
});

test("'atendente' uma vez só", () => {
  assert.equal(
    semAtendenteRepetida("Recebemos seu pedido. Uma atendente já vai gerar e te mandar para conferir. Uma atendente já vai te passar os preços."),
    "Recebemos seu pedido. Uma atendente já vai gerar e te mandar para conferir.",
  );
});

test("pedido: nunca 'o que mais você precisa'", () => {
  const d = aplicarTravas({ resposta: "Olá, boa tarde! O que mais você precisa além do galão de água?", assunto: "pedido", passar: false }, {
    ...aberto,
    textoCliente: "Gostaria de pedir um galão de água",
  });
  assert.equal(d.passar, true);
  assert.doesNotMatch(d.resposta, /o que mais|além/);
});

test("gentileza: 'tudo ótimo' vira 'tudo bem'", () => {
  const d = aplicarTravas({ resposta: "Olá, boa tarde! Aqui é da Beba Mais, tudo ótimo por aqui! Como podemos ajudar?", assunto: "outro", passar: false }, {
    ...aberto,
    textoCliente: "Boa tarde, tudo bem?",
  });
  assert.match(d.resposta, /tudo bem por aqui/);
});

test("contatos internos: mesmo telefone escrito de jeitos diferentes", () => {
  assert.equal(mesmoTelefone("5519999990000", "Osmar (19) 99999-0000"), true);
  assert.equal(mesmoTelefone("551999990000", "19 99999-0000"), true, "formato antigo sem o 9");
  assert.equal(mesmoTelefone("5519999990000", "11 99999-0000"), false, "outro DDD");
  assert.equal(mesmoTelefone("5519999990000", "99999-0000"), true, "sem DDD compara o final");
  assert.equal(mesmoTelefone("5519999990001", "19 99999-0000"), false);
  const cfg = normalizarConfig({ contatos_internos: ["Osmar (19) 99999-0000", "Financeiro 19 98888-7777", "sem telefone", 123] });
  assert.deepEqual(cfg.contatos_internos, ["Osmar (19) 99999-0000", "Financeiro 19 98888-7777"]);
  assert.equal(ehContatoInterno("5519988887777", cfg), true);
  assert.equal(ehContatoInterno("5519977776666", cfg), false);
  assert.equal(ehContatoInterno("", cfg), false);
});

test("pedido: pergunta só o que falta (entrega/retirada, endereço, gelado)", () => {
  assert.equal(perguntaDoPedido("2 fardo de Heineken"), "É para entrega ou retirada, e vai querer algo gelado?");
  assert.equal(perguntaDoPedido("Gostaria de pedir um galão de água"), "É para entrega ou retirada?", "galão não se gela");
  assert.equal(perguntaDoPedido("3 sacos de gelo e 2 carvão, vou buscar aí"), null);
  assert.equal(perguntaDoPedido("Quero 2 fardos de coca gelada para entregar hoje às 16h na Rua das Palmeiras, 100"), null);
  assert.equal(perguntaDoPedido("pode entregar 2 caixas de skol"), "Qual o endereço de entrega, e vai querer algo gelado?");
  assert.equal(perguntaDoPedido("1 fardo coca (gelada) 1 fardo água 500 ml"), "É para entrega ou retirada?");
  assert.equal(perguntaDoPedido("[enviou uma foto] segue o pedido da semana"), "É para entrega ou retirada, e vai querer algo gelado?");
});

test("pedido aberto: resposta da IA ganha a pergunta certa no fim", () => {
  const d = aplicarTravas(
    { resposta: "Olá, boa tarde! Recebemos seu pedido! Uma atendente já vai gerar e te mandar para conferir. É para entrega ou retirada, e vai querer algo gelado?", assunto: "pedido", passar: true },
    { ...aberto, textoCliente: "Quero 2 fardos de coca gelada para entregar hoje às 16h na Rua das Palmeiras, 100" },
  );
  assert.equal(d.resposta, "Olá, boa tarde! Recebemos seu pedido! Uma atendente já vai gerar e te mandar para conferir.");
});

test("comprovante: PDF com nome de banco e PIX colado no nome", () => {
  assert.equal(ehComprovante("[enviou um arquivo: sicredi_1792759007160.pdf]"), true);
  assert.equal(ehComprovante("[enviou um arquivo: SICOOB_2026_21_10_09_09_55_PIX.pdf]"), true);
  assert.equal(ehComprovante("[enviou um arquivo: cardapio_pixel.pdf]"), false, "pixel não é pix");
});

test("pediu os dados do Pix: a atendente manda (não lista formas de pagamento)", () => {
  const d = aplicarTravas({ resposta: "Olá, boa tarde! Aceitamos Pix, dinheiro e cartão. Podemos ajudar em algo mais?", assunto: "duvida", passar: false }, {
    ...aberto,
    textoCliente: "boa tarde\ntudo bem?\nme passa o PIX para pagamento",
  });
  assert.equal(d.passar, true);
  assert.match(d.resposta, /dados do Pix/);
  assert.doesNotMatch(d.resposta, /dinheiro|cartão/);
});

test("comprovante junto com pedido: fala dos dois", () => {
  const d = aplicarTravas({ resposta: "Recebemos seu pedido!", assunto: "pedido", passar: true }, {
    ...aberto,
    textoCliente: "[enviou um arquivo: SICOOB_PIX.pdf]\nPago\nPedido de hoje: 2 galões",
  });
  assert.match(d.resposta, /comprovante e o seu pedido/);
});

test("arquivo de pedido vira pedido (não 'foto')", () => {
  const d = aplicarTravas({ resposta: "Olá, bom dia! Recebemos a sua foto! Uma atendente já confere e te responde.", assunto: "outro", passar: true }, {
    ...aberto,
    textoCliente: "[enviou um arquivo: pedido_restaurante.xlsx]",
  });
  assert.equal(d.assunto, "pedido");
  assert.match(d.resposta, /Recebemos seu pedido!/);
  assert.match(d.resposta, /entrega ou retirada/);
});

test("pedido com produto não fica com o assistente", () => {
  const d = aplicarTravas({ resposta: "Olá, boa tarde! Pode mandar o seu pedido!", assunto: "pedido", passar: false }, {
    ...aberto,
    textoCliente: "Boa tarde\nGostaria de pedir um galão de água",
  });
  assert.equal(d.passar, true);
  assert.match(d.resposta, /Recebemos seu pedido! Uma atendente já vai gerar e te mandar para conferir\. É para entrega ou retirada\?$/);
  const semItem = aplicarTravas({ resposta: "Olá, boa tarde! Pode mandar o seu pedido!", assunto: "pedido", passar: false }, {
    ...aberto,
    textoCliente: "Vou fazer o pedido",
  });
  assert.equal(semItem.passar, false);
});

test("vídeo ou arquivo não vira 'foto'", () => {
  const d = aplicarTravas({ resposta: "Olá, bom dia! Recebemos a sua foto! Uma atendente já confere e te responde.", assunto: "outro", passar: true }, {
    ...aberto,
    textoCliente: "[enviou um vídeo]",
  });
  assert.match(d.resposta, /Recebemos o seu vídeo!/);
});

test("entrega fora de Americana: nunca afirma", () => {
  const d = aplicarTravas({ resposta: "Olá, bom dia! Entregamos em alguns bairros de Nova Odessa. Uma atendente confirma o seu endereço com você.", assunto: "duvida", passar: true }, {
    ...aberto,
    textoCliente: "Vocês fazem entregas em Nova Odessa ??",
  });
  assert.equal(d.resposta, "Olá, boa tarde! Uma atendente confirma se entregamos no seu endereço.");
  const americana = aplicarTravas({ resposta: "Olá, bom dia! Entregamos em todos os bairros de Americana. Uma atendente confirma o seu endereço com você.", assunto: "duvida", passar: true }, {
    ...aberto,
    textoCliente: "Vocês entregam no Jardim Paulista?",
  });
  assert.match(americana.resposta, /todos os bairros de Americana/);
});
