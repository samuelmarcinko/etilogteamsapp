#!/bin/bash
# =============================================================================
# Čierna skrinka pre sieť VPS
# =============================================================================
#
# Toto tu je preto, že sa portál opakovane stráca zo sveta a spätne sa nedá
# povedať, čo presne sa stalo. Zvonku vidíme len „Connection Timeout" - a ten
# vyzerá úplne rovnako, či server zamrzol, či mu niekto odrezal sieť, alebo či
# ho poskytovateľ odstavil. Sú to tri celkom iné príčiny a tri celkom iné
# opravy, ale rozoznať sa dajú jedine zvnútra stroja, v okamihu, keď to padne.
#
# Preto tento skript beží stále a každých pár sekúnd zapíše jeden riadok:
#
#   čas | brána | internet | DNS | appka | load | voľná pamäť
#
# Ako sa ten záznam po výpadku číta:
#
#   riadky sa počas výpadku prestali písať
#       -> stroj bol mŕtvy alebo zamrznutý (toto sa stalo 15. 9.)
#
#   riadky bežia ďalej, brána aj internet OK
#       -> stroj žil a von sa dostal; zvonku sa k nemu nedalo
#          -> filtrovanie na vstupe: poskytovateľ, alebo firewall na stroji
#
#   riadky bežia ďalej, brána OK, internet zlyháva
#       -> linka k smerovaču poskytovateľa žije, ale ďalej sa nejde
#          -> problém je na sieti poskytovateľa (typicky odstavená IP adresa)
#
#   riadky bežia ďalej, zlyháva už brána
#       -> stroju odrezali sieť úplne (vypnutý port, odobratá adresa)
#
#   všetko OK, len appka neodpovedá na 127.0.0.1
#       -> sieť je v poriadku a problém je v kontajneri; nič z toho vyššie
#
# Okrem toho sleduje pamäť. Keď prekročí prah, odfotí zoznam procesov podľa
# spotreby - a to je tá časť, kvôli ktorej to celé vzniklo. Server nám padal
# tak, že si niečo za pár minút vypýtalo desať gigabajtov, držalo ich hodiny a
# samo skončilo; spätne sa už nedalo zistiť čo, lebo záznam jadra sa reštartom
# stratil. Prah je naschvál nižšie, než kde stroj prestane stíhať: v tej chvíli
# ešte `ps` dobehne a vinník je v zázname aj vtedy, keď to celé zase samo
# ožije a nikto sa na server nedostane včas.
#
# Zámerne to nepotrebuje nič, čo nie je v každom Debiane: bash, ping, awk.
# Žiadny balík navyše, nič, čo by sa dalo pokaziť aktualizáciou.
#
# Inštalácia na VPS (raz):
#
#   sudo install -m 755 vps-netwatch.sh /usr/local/bin/etilog-netwatch
#   sudo /usr/local/bin/etilog-netwatch install
#
# Čítanie po výpadku:
#
#   /usr/local/bin/etilog-netwatch show "2026-09-17 19:00" "2026-09-18 00:30"
#
# =============================================================================

set -u

LOG_DIR="${NETWATCH_LOG_DIR:-/var/log/etilog-netwatch}"
INTERVAL="${NETWATCH_INTERVAL:-15}"

# Ako sa pýtame portálu, či žije.
#
# Nie priamo na port kontajnera - ten sa na hostiteľa nevystavuje, chodí sa naň
# cez Traefik, takže priame spojenie by hlásilo poruchu vždy. Ide sa teda tou
# istou cestou ako skutočný návštevník, ale po `127.0.0.1`: overí to aj Traefik,
# aj appku, a neopustí to stroj. To je podstatné - keď je výpadok, von sa
# nedostaneme, a práve vtedy chceme vedieť, či portál vnútri ešte odpovedá.
#
# `-k` preto, že certifikát je vystavený na `portal.etilog.com`, nie na
# `127.0.0.1`; čo sa tu overuje, je appka, nie platnosť certifikátu.
APP_URL="${NETWATCH_APP_URL:-https://127.0.0.1/health}"
APP_HOST="${NETWATCH_APP_HOST:-portal.etilog.com}"

# Adresa mimo poskytovateľa, na ktorej sa overuje, či sa dá von. Dve, aby výpadok
# jednej neznamenal falošný poplach - riadok hlásí problém, až keď mlčia obe.
PROBE_HOSTS="${NETWATCH_PROBE_HOSTS:-1.1.1.1 8.8.8.8}"
PROBE_PORT=443

# Meno, ktoré sa skúša preložiť. Pokazené DNS vyzerá zvonku identicky ako
# mŕtva sieť, hoci je to celkom iná porucha - stojí za to ich rozlíšiť.
PROBE_NAME="${NETWATCH_PROBE_NAME:-portal.etilog.com}"

RETAIN_DAYS="${NETWATCH_RETAIN_DAYS:-30}"

# Koľko miesta si to smie vziať.
#
# Riadok má okolo 105 bajtov a píšu sa štyri za minútu, teda asi 0,6 MB za deň
# a 18 MB za mesiac - menej, než na ten istý disk denne sype `ufw`. To platí,
# kým je pokoj. Keby sa stav siete rozkmital, odfotí sa pri každej zmene aj
# stav adries a spojení, a to je už rádovo inak.
#
# Preto tieto dve poistky. Strážca, ktorý zaplní disk, je horší než žiadny
# strážca: zhodil by presne to, čo má chrániť. Keď sa prekročí jedno z týchto
# čísel, prestanú sa písať podrobnosti a zostane len jednoriadkový tep - ten
# stojí za to udržať vždy, lebo práve z neho sa spätne číta, kedy to padlo.
MAX_DAY_MB="${NETWATCH_MAX_DAY_MB:-50}"
MIN_FREE_MB="${NETWATCH_MIN_FREE_MB:-500}"

# Pri koľkých percentách obsadenej pamäte sa zapíše zoznam procesov, a ako
# často najviac. Osemdesiat je zámerne skoro: stroj vtedy ešte funguje a `ps`
# dobehne. Keby sa čakalo na deväťdesiatpäť, už sa nemusí podariť nič spustiť -
# a práve vtedy to potrebujeme najviac.
MEM_ALERT="${NETWATCH_MEM_ALERT:-80}"
MEM_DUMP_EVERY="${NETWATCH_MEM_DUMP_EVERY:-120}"

# -----------------------------------------------------------------------------
# Jednotlivé skúšky. Každá vráti OK / FAIL a nikdy sa nezasekne - časový strop
# je tu podstatnejší než presnosť: zaseknutá skúška by prestala zapisovať a
# záznam by vyzeral presne ako mŕtvy stroj, teda ako to, čo máme rozlíšiť.
# -----------------------------------------------------------------------------

tcp_open() {          # tcp_open <host> <port> <sekundy>
  timeout "$3" bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null && return 0
  return 1
}

check_gateway() {
  local gw
  gw=$(ip route show default 2>/dev/null | awk '/default/ {print $3; exit}')
  if [ -z "$gw" ]; then
    echo "NOGW"                       # stroj už ani nevie, kadiaľ von
    return
  fi
  if ping -c1 -W2 -n "$gw" >/dev/null 2>&1; then echo "OK"; else echo "FAIL"; fi
}

check_internet() {
  local host
  for host in $PROBE_HOSTS; do
    if tcp_open "$host" "$PROBE_PORT" 4; then echo "OK"; return; fi
  done
  echo "FAIL"
}

check_dns() {
  if timeout 4 getent hosts "$PROBE_NAME" >/dev/null 2>&1; then echo "OK"; else echo "FAIL"; fi
}

check_app() {
  local code
  code=$(curl -s -k -m 5 -o /dev/null -w '%{http_code}' -H "Host: $APP_HOST" "$APP_URL" 2>/dev/null)
  # Zapisuje sa aj samotný návratový kód: „appka=502" hovorí o poruche niečo
  # celkom iné než „appka=000" (nespojilo sa vôbec), a spätne je ten rozdiel
  # presne to, čo človek potrebuje vedieť.
  case "$code" in
    200) echo "OK" ;;
    ''|000) echo "FAIL" ;;
    *) echo "$code" ;;
  esac
}

# -----------------------------------------------------------------------------
# Keď sa niečo pokazí, jedenkrát sa odfotí stav siete.
#
# Práve toto spätne rozhodne, či adresa zmizla, či prestal odpovedať smerovač,
# alebo či pakety odchádzajú a nikto neodpovedá. Píše sa len pri zmene stavu,
# nie každých pätnásť sekúnd - inak by sa to v zázname stratilo.
# -----------------------------------------------------------------------------
free_mb() {
  df -Pm "$LOG_DIR" 2>/dev/null | awk 'NR == 2 { print $4 + 0 }'
}

# Smie sa teraz zapísať niečo objemné? Dve podmienky: dnešný súbor ešte nie je
# prerastený a na disku je miesto. Miesto sa nezisťuje pri každom kole - `df`
# štyrikrát za minútu je zbytočná práca, stav disku sa za desať minút nezmení.
detail_allowed() {
  local bytes
  bytes=$(stat -c %s "$1" 2>/dev/null || echo 0)
  [ "$bytes" -lt $((MAX_DAY_MB * 1024 * 1024)) ] || return 1
  [ "${free_space:-999999}" -ge "$MIN_FREE_MB" ] || return 1
  return 0
}

mem_used_percent() {
  # Počíta sa z MemAvailable, nie z `free`: to je jediné číslo, ktoré hovorí,
  # koľko sa naozaj dá ešte rozdať. Vyrovnávacia pamäť sa uvoľní sama a do
  # obsadenosti nepatrí.
  awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {if (t) printf "%d", (t-a)*100/t; else printf "0"}' \
    /proc/meminfo 2>/dev/null
}

dump_memory_hogs() {
  local out="$1" pct="$2"
  {
    echo "--- $(date -u '+%F %T') UTC  pamat na $pct %, najvacsie procesy:"
    # Vlákna jadra a drobné procesy sa vynechávajú - hľadá sa niekto, kto drží
    # gigabajty, a pätnásť riadkov s nulou by ho len zatlačilo z obrazovky.
    ps -eo rss=,pid=,args= --sort=-rss 2>/dev/null | awk '$1 > 20480' | head -15 |
      awk '{ rss = $1 / 1024; pid = $2; $1 = ""; $2 = "";
             printf "    %7.0f MB  pid %-7s %s\n", rss, pid, substr($0, 3, 110) }'
    echo "--- koniec"
  } >> "$out"
}

snapshot() {
  local why="$1" out="$2"
  {
    echo "--- $(date -u '+%F %T') UTC  zmena stavu: $why"
    echo "  adresy:"; ip -brief address show 2>&1 | sed 's/^/    /'
    echo "  cesty:";  ip route show 2>&1 | sed 's/^/    /'
    echo "  susedia:"; ip neigh show 2>&1 | sed 's/^/    /'
    echo "  sokety:"; ss -s 2>&1 | sed 's/^/    /'
    echo "---"
  } >> "$out"
}

run() {
  mkdir -p "$LOG_DIR"
  local last_state="" iterations=0 last_dump=0 warned_full=0
  local free_space
  free_space=$(free_mb)

  while :; do
    local day file gw net dns app load mem pct now state
    day=$(date -u '+%F')
    file="$LOG_DIR/$day.log"

    gw=$(check_gateway)
    net=$(check_internet)
    dns=$(check_dns)
    app=$(check_app)
    load=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
    mem=$(awk '/MemAvailable/ {printf "%dMB", $2/1024}' /proc/meminfo 2>/dev/null)
    pct=$(mem_used_percent)

    printf '%s brana=%s internet=%s dns=%s appka=%s load=%s pamat=%s%% volna_pamat=%s\n' \
      "$(date -u '+%F %T')" "$gw" "$net" "$dns" "$app" "$load" "$pct" "$mem" >> "$file"

    # Kto drží pamäť. Píše sa, kým je nad prahom - nie raz pri prekročení:
    # z toho, ako tie čísla medzi zápismi rastú, je vidieť, ktorý proces sa
    # nafukuje, a to je rozdiel medzi „server mal plnú pamäť" a menom vinníka.
    now=$(date +%s)
    if [ "${pct:-0}" -ge "$MEM_ALERT" ] && [ $((now - last_dump)) -ge "$MEM_DUMP_EVERY" ] \
       && detail_allowed "$file"; then
      dump_memory_hogs "$file" "$pct"
      last_dump=$now
    fi

    state="$gw/$net/$dns/$app"
    if [ "$state" != "$last_state" ]; then
      [ -n "$last_state" ] && detail_allowed "$file" && snapshot "$last_state -> $state" "$file"
      last_state="$state"
    fi

    # Upratovanie raz za čas, nie pri každom kole.
    iterations=$((iterations + 1))
    if [ $((iterations % 40)) -eq 0 ]; then
      free_space=$(free_mb)
      # Povie sa to raz. Opakovať do súboru, že v ňom už nie je miesto, by bolo
      # to isté, čo sa práve snažíme neurobiť.
      if [ "${free_space:-999999}" -lt "$MIN_FREE_MB" ] && [ "$warned_full" -eq 0 ]; then
        printf '%s POZOR: na disku zostava %s MB, podrobne zaznamy sa vypinaju\n' \
          "$(date -u '+%F %T')" "$free_space" >> "$file"
        warned_full=1
      elif [ "${free_space:-0}" -ge "$MIN_FREE_MB" ]; then
        warned_full=0
      fi
    fi
    if [ $((iterations % 240)) -eq 0 ]; then
      find "$LOG_DIR" -name '*.log' -mtime "+$RETAIN_DAYS" -delete 2>/dev/null
    fi

    sleep "$INTERVAL"
  done
}

# -----------------------------------------------------------------------------
# Inštalácia ako služba.
#
# Vedome nezávisí na ničom okrem siete: píše na koreňový disk, nie na /mnt/data,
# a štartuje čo najskôr. Služba, ktorá čaká na prípojku, ktorá sa nepripojí, by
# o výpadku nezapísala ani riadok - a presne o tom výpadku ide.
# -----------------------------------------------------------------------------
install_service() {
  cat > /etc/systemd/system/etilog-netwatch.service <<'UNIT'
[Unit]
Description=ETILOG - zaznamenava stav siete VPS (cierna skrinka pre vypadky)
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=/usr/local/bin/etilog-netwatch run
Restart=always
RestartSec=5
Nice=10

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now etilog-netwatch.service
  echo "Hotovo. Zaznam: $LOG_DIR/<datum>.log"
  echo "Stav sluzby:   systemctl status etilog-netwatch --no-pager"
}

# `show` zámerne vypisuje len riadky, kde nie je všetko OK, plus okolie zmien -
# za štyri hodiny výpadku je tých riadkov okolo tisícky a čítať sa to inak nedá.
show_window() {
  local from="$1" to="$2"
  local day
  for day in $(ls "$LOG_DIR"/*.log 2>/dev/null); do
    awk -v from="$from" -v to="$to" -v alert="$MEM_ALERT" '
      # Odfotené zoznamy procesov a ich okolie sa vypisujú vždy - kvôli nim to
      # celé je. Rovnako riadok, kde je síce všetko dostupné, ale pamäť je
      # vysoko: to je začiatok problému, nie pokoj.
      /^---/ || /^ +[0-9]+ MB/ { print; next }
      { stamp = $1 " " $2 }
      stamp >= from && stamp <= to {
        pct = 0
        if (match($0, /pamat=[0-9]+%/)) pct = substr($0, RSTART + 6, RLENGTH - 7) + 0
        if (/brana=OK internet=OK dns=OK appka=OK/ && pct < alert) { ok++; next }
        if (ok) { printf "  ... %d riadkov, ked bolo vsetko v poriadku\n", ok; ok = 0 }
        print
      }
      END { if (ok) printf "  ... %d riadkov, ked bolo vsetko v poriadku\n", ok }
    ' "$day"
  done
}

case "${1:-run}" in
  run)     run ;;
  install) install_service ;;
  show)    show_window "${2:?od kedy, napr. \"2026-09-17 19:00\"}" "${3:?do kedy}" ;;
  *)       echo "pouzitie: $0 [run|install|show <od> <do>]" >&2; exit 2 ;;
esac
