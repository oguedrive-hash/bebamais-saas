#!/bin/sh
# Rotinas automáticas do painel, rodando DENTRO do compose (serviço `crons`).
# Hoje só existe uma: a mensagem de espera para quem aguarda atendente (1x/min).
# As rotinas antigas do Caio (follow-up, prospecção, lembretes, retomadas) foram
# removidas de propósito: o pré-atendente não manda mensagem que o cliente não pediu.
set -eu
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1

# Header num arquivo para o segredo não aparecer na lista de processos.
HDR=/tmp/cron-auth-header
umask 077
printf 'Authorization: Bearer %s\n' "${CRON_SECRET}" > "$HDR"
BASE="http://painel/api/cron"

hit() { curl -sS -m 55 -X POST -H "@$HDR" "$BASE/$1" >/dev/null 2>&1 || true; }

echo "[crons] iniciado — espera 1x/min"
while true; do
  hit espera
  sleep 60
done
