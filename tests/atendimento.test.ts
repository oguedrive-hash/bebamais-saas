/**
 * Testes das regras do pré-atendente (sem banco e sem WhatsApp).
 * Rodar: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_PADRAO,
  avisoDeEsperaDevido,
  decidirEntrada,
  estaAberto,
  normalizarConfig,
  proximaAbertura,
} from "../src/lib/atendimento/regras";
import { normalizarMensagem } from "../src/lib/atendimento/inbound";
import { aplicarTravas, interpretarResposta, saudacaoPara, type ContextoTravas, type Decisao } from "../src/lib/atendimento/assistente";

// Datas em horário de São Paulo (UTC-3): 2026-10-06 é terça-feira.
const sp = (iso: string) => new Date(`${iso}-03:00`);

test("loja aberta e fechada conforme o horário", () => {
  assert.equal(estaAberto(CONFIG_PADRAO, sp("2026-10-06T09:30:00")), true);
  assert.equal(estaAberto(CONFIG_PADRAO, sp("2026-10-06T07:59:00")), false);
  assert.equal(estaAberto(CONFIG_PADRAO, sp("2026-10-06T18:00:00")), false);
  assert.equal(estaAberto(CONFIG_PADRAO, sp("2026-10-10T12:00:00")), true); // sábado até 13h
  assert.equal(estaAberto(CONFIG_PADRAO, sp("2026-10-11T10:00:00")), false); // domingo fechado
});

test("próxima abertura em texto", () => {
  assert.equal(proximaAbertura(CONFIG_PADRAO, sp("2026-10-06T06:00:00")), "hoje às 08:00");
  assert.equal(proximaAbertura(CONFIG_PADRAO, sp("2026-10-06T20:00:00")), "amanhã (quarta-feira) às 08:00");
  assert.equal(proximaAbertura(CONFIG_PADRAO, sp("2026-10-10T15:00:00")), "segunda-feira às 08:00");
});

test("config do banco incompleta vira padrão", () => {
  const c = normalizarConfig({ horarios: { seg: { abre: "25:00", fecha: "18:00" }, dom: null }, espera_minutos: [15, "x", 5] });
  assert.deepEqual(c.horarios.seg, CONFIG_PADRAO.horarios.seg);
  assert.equal(c.horarios.dom, null);
  assert.deepEqual(c.espera_minutos, [5, 15]);
  assert.equal(c.assistente_ativo, true);
  assert.equal(c.cidade, "Americana/SP");
});

const agora = sp("2026-10-06T10:00:00");
const haMinutos = (m: number) => new Date(agora.getTime() - m * 60_000).toISOString();

test("cliente novo: assistente responde", () => {
  const d = decidirEntrada({ atend_status: "bot", ultima_atividade_em: null, caio_ativo: true }, CONFIG_PADRAO, agora, true);
  assert.deepEqual(d, { novaConversa: true, status: "bot", assistenteResponde: true });
});

test("conversa com atendente: assistente fica quieto", () => {
  const d = decidirEntrada({ atend_status: "atendendo", ultima_atividade_em: haMinutos(10), caio_ativo: true }, CONFIG_PADRAO, agora, true);
  assert.deepEqual(d, { novaConversa: false, status: "atendendo", assistenteResponde: false });
});

test("esperando atendente: mensagem nova não aciona o assistente", () => {
  const d = decidirEntrada({ atend_status: "aguardando", ultima_atividade_em: haMinutos(2), caio_ativo: true }, CONFIG_PADRAO, agora, true);
  assert.equal(d.assistenteResponde, false);
  assert.equal(d.status, "aguardando");
});

test("atendimento finalizado: próxima mensagem abre conversa nova", () => {
  const d = decidirEntrada({ atend_status: "finalizado", ultima_atividade_em: haMinutos(5), caio_ativo: false }, CONFIG_PADRAO, agora, true);
  assert.deepEqual(d, { novaConversa: true, status: "bot", assistenteResponde: true });
});

test("conversa parada há mais de 6 horas recomeça", () => {
  const d = decidirEntrada({ atend_status: "atendendo", ultima_atividade_em: haMinutos(7 * 60), caio_ativo: true }, CONFIG_PADRAO, agora, true);
  assert.equal(d.novaConversa, true);
  assert.equal(d.assistenteResponde, true);
});

test("assistente desligado: cliente vai direto para a fila", () => {
  const off = { ...CONFIG_PADRAO, assistente_ativo: false };
  const d = decidirEntrada({ atend_status: "bot", ultima_atividade_em: null, caio_ativo: true }, off, agora, true);
  assert.deepEqual(d, { novaConversa: true, status: "aguardando", assistenteResponde: false });
  const semNumero = decidirEntrada({ atend_status: "bot", ultima_atividade_em: null, caio_ativo: true }, CONFIG_PADRAO, agora, false);
  assert.equal(semNumero.status, "aguardando");
});

test("mensagens de espera: 5 e 15 minutos, no máximo 2, só com a loja aberta", () => {
  assert.equal(avisoDeEsperaDevido(haMinutos(3), 0, null, CONFIG_PADRAO, agora), null);
  assert.equal(avisoDeEsperaDevido(haMinutos(6), 0, null, CONFIG_PADRAO, agora), 0);
  assert.equal(avisoDeEsperaDevido(haMinutos(10), 1, haMinutos(4), CONFIG_PADRAO, agora), null);
  assert.equal(avisoDeEsperaDevido(haMinutos(16), 1, haMinutos(11), CONFIG_PADRAO, agora), 1);
  assert.equal(avisoDeEsperaDevido(haMinutos(60), 2, haMinutos(30), CONFIG_PADRAO, agora), null);
  assert.equal(avisoDeEsperaDevido(haMinutos(60), 0, null, CONFIG_PADRAO, sp("2026-10-06T21:00:00")), null);
});

test("quem chegou com a loja fechada não recebe as duas mensagens de espera de uma vez na abertura", () => {
  const ontemNoite = sp("2026-10-05T19:00:00").toISOString();
  assert.equal(avisoDeEsperaDevido(ontemNoite, 0, null, CONFIG_PADRAO, sp("2026-10-06T08:02:00")), null); // abriu há 2 min
  assert.equal(avisoDeEsperaDevido(ontemNoite, 0, null, CONFIG_PADRAO, sp("2026-10-06T08:05:00")), 0);
  const primeiro = sp("2026-10-06T08:05:00").toISOString();
  assert.equal(avisoDeEsperaDevido(ontemNoite, 1, primeiro, CONFIG_PADRAO, sp("2026-10-06T08:06:00")), null);
  assert.equal(avisoDeEsperaDevido(ontemNoite, 1, primeiro, CONFIG_PADRAO, sp("2026-10-06T08:15:00")), 1);
});

test("cliente na fila não perde o lugar mesmo depois de horas", () => {
  const d = decidirEntrada({ atend_status: "aguardando", ultima_atividade_em: haMinutos(13 * 60), caio_ativo: true }, CONFIG_PADRAO, agora, true);
  assert.deepEqual(d, { novaConversa: false, status: "aguardando", assistenteResponde: false });
});

test("lê os tipos de mensagem do WhatsApp", () => {
  assert.deepEqual(normalizarMensagem({ conversation: " oi " }), { tipo: "texto", texto: "oi", midia: null, ignorar: false });
  assert.equal(normalizarMensagem({ extendedTextMessage: { text: "25 fardo de coca" } }).texto, "25 fardo de coca");
  const foto = normalizarMensagem({ imageMessage: { caption: "meu pedido", mimetype: "image/jpeg" } });
  assert.equal(foto.tipo, "imagem");
  assert.equal(foto.texto, "meu pedido");
  const doc = normalizarMensagem({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "pedido.xlsx", mimetype: "application/vnd.ms-excel" } } } });
  assert.equal(doc.tipo, "arquivo");
  assert.equal(doc.midia?.nome, "pedido.xlsx");
  const loc = normalizarMensagem({ locationMessage: { degreesLatitude: -22.7, degreesLongitude: -47.3, name: "Bar do Zé" } });
  assert.equal(loc.tipo, "localizacao");
  assert.match(loc.texto ?? "", /maps\.google\.com\/\?q=-22\.7,-47\.3/);
  assert.equal(normalizarMensagem({ reactionMessage: { text: "👍" } }).ignorar, true);
  assert.equal(normalizarMensagem({ ephemeralMessage: { message: { conversation: "temporária" } } }).texto, "temporária");
  assert.equal(normalizarMensagem({ audioMessage: { mimetype: "audio/ogg; codecs=opus" } }).midia?.mime, "audio/ogg");
});

test("resposta da IA: JSON válido é usado, inválido vira passar para atendente", () => {
  const ok = interpretarResposta('{"resposta":"Olá, bom dia! Como posso ajudar?","assunto":"outro","passar_para_atendente":false}', true);
  assert.deepEqual(ok, { resposta: "Olá, bom dia! Como posso ajudar?", assunto: "outro", passar: false });
  const ruim = interpretarResposta("não sou json", true);
  assert.equal(ruim.passar, true);
  const assuntoEstranho = interpretarResposta('{"resposta":"ok","assunto":"xyz"}', true);
  assert.equal(assuntoEstranho.assunto, "outro");
});

const ctx = (respostasJaDadas: number, extra: Partial<ContextoTravas> = {}): ContextoTravas => ({
  respostasJaDadas,
  aberto: true,
  saudacao: "boa tarde",
  ...extra,
});
const d = (resposta: string, assunto: Decisao["assunto"] = "duvida", passar = false): Decisao => ({ resposta, assunto, passar });

test("trava: nunca manda valor em dinheiro, escrito de qualquer jeito", () => {
  for (const r of ["A Heineken sai R$ 6,50", "Fica 6,50 cada", "São 30 reais", "Tá 89 o fardo", "45 conto a caixa"]) {
    const t = aplicarTravas(d(r), ctx(1));
    assert.equal(t.passar, true, r);
    assert.doesNotMatch(t.resposta, /\d/, r);
  }
});

test("trava: nunca repete a lista do pedido", () => {
  const t = aplicarTravas(d("Recebi seu pedido de 3 fardos de Skol e 2 de Coca 2L.", "pedido", true), ctx(0));
  assert.equal(t.resposta, "Olá, boa tarde! Recebemos seu pedido, uma atendente já vai gerar e te mandar para conferir.");
  assert.equal(t.passar, true);
});

test("trava: se fala em atendente, passa a conversa", () => {
  const t = aplicarTravas(d("A atendente pode confirmar se entregamos no Parque das Árvores."), ctx(1));
  assert.equal(t.passar, true);
});

test("tom: cumprimento certo para o horário, sempre na primeira resposta, no plural", () => {
  assert.equal(saudacaoPara(9 * 60), "bom dia");
  assert.equal(saudacaoPara(14 * 60 + 30), "boa tarde");
  assert.equal(saudacaoPara(20 * 60), "boa noite");
  assert.equal(aplicarTravas(d("Olá, bom dia! Como posso ajudar?"), ctx(0)).resposta, "Olá, boa tarde! Como podemos ajudar?");
  assert.equal(aplicarTravas(d("A atendente já passa essa informação.", "duvida", true), ctx(0)).resposta, "Olá, boa tarde! A atendente já passa essa informação.");
  assert.equal(aplicarTravas(d("Recebi as informações."), ctx(1)).resposta, "Recebemos as informações.");
});

test("assunto da conversa não se perde; depois de 3 respostas passa para a atendente", () => {
  assert.equal(aplicarTravas(d("Obrigado pelas informações.", "outro"), ctx(1, { assuntoAnterior: "orcamento" })).assunto, "orcamento");
  assert.equal(aplicarTravas(d("Me conta o que precisa?", "pedido"), ctx(2)).passar, true);
  assert.equal(aplicarTravas(d("Me conta o que precisa?", "pedido"), ctx(0)).passar, false);
});

test("feriado cadastrado: loja fechada no dia e próxima abertura pula o feriado", () => {
  const cfg = { ...CONFIG_PADRAO, dias_fechados: ["2026-10-12"] }; // segunda-feira
  assert.equal(estaAberto(cfg, sp("2026-10-12T10:00:00")), false);
  assert.equal(estaAberto(cfg, sp("2026-10-13T10:00:00")), true);
  assert.equal(proximaAbertura(cfg, sp("2026-10-11T10:00:00")), "terça-feira às 08:00");
  assert.equal(proximaAbertura(cfg, sp("2026-10-12T09:00:00")), "amanhã (terça-feira) às 08:00");
  assert.equal(avisoDeEsperaDevido(sp("2026-10-12T09:00:00").toISOString(), 0, null, cfg, sp("2026-10-12T11:00:00")), null);
  assert.deepEqual(normalizarConfig({ dias_fechados: ["2026-10-12", "lixo", "2026-10-12", 5] }).dias_fechados, ["2026-10-12"]);
});

test("loja fechada: assunto da loja sempre vai para a fila; conversa fiada não", () => {
  const fechado = ctx(1, { aberto: false });
  const t = aplicarTravas(d("Estamos fechados hoje e abrimos amanhã às 08:00. Podemos ajudar com mais alguma coisa?", "duvida"), fechado);
  assert.equal(t.passar, true);
  assert.equal(t.resposta, "Estamos fechados hoje e abrimos amanhã às 08:00. Uma atendente te responde assim que a loja abrir.");
  assert.equal(aplicarTravas(d("Aqui é o atendimento da loja. Podemos ajudar com algum pedido?", "outro"), fechado).passar, false);
});

test("tom: fala com o cliente como você", () => {
  assert.equal(aplicarTravas(d("Sim, o cliente pode retirar o pedido na loja."), ctx(1)).resposta, "Sim, você pode retirar o pedido na loja.");
});
