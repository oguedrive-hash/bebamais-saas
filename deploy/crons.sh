#!/bin/sh
# Crons do Caio rodando DENTRO do compose (serviço `crons`, alpine).
# Bate os endpoints do painel pela rede interna (http://painel:80). Espelha o
# /etc/cron.d da Facilita: followup + prospeccao 4x/min (:00/:15/:30/:45),
# lembretes + retomadas 1x/min.
set -eu
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1

H="Authorization: Bearer ${CRON_SECRET}"
BASE="http://painel/api/cron"

hit() { curl -sS -m 110 -X POST -H "$H" "$BASE/$1" >/dev/null 2>&1 || true; }

echo "[crons] iniciado — followup/prospeccao 4x/min, lembretes/retomadas 1x/min"
while true; do
  # responsividade de 15s: dispara em :00/:15/:30/:45 dentro do minuto
  for off in 0 15 30 45; do
    ( sleep "$off"; hit followup; hit prospeccao ) &
  done
  # 1x/min (não precisam responsividade)
  hit lembretes
  hit retomadas
  sleep 60
  wait 2>/dev/null || true
done
