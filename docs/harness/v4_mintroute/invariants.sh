#!/bin/bash
# Invariant battery for structure 4 on the nine-node field: ../v4_static's
# battery (itself ../v3_flood's, I9 restated per timer) with two changes for
# step 3g (user, 2026-10-13):
#   - Q8 = b: only the sink beacons, so I9a ("every node outside Dests
#     originates a type evenly") covers the nodes whose timer for that type is
#     armed (interval > 0); a node with the timer off must originate none (I9b
#     already says so: cap 0).
#   - It can check an existing run: SCA=<path> ./invariants.sh (loop.sh does).
#
# ⚠ EVERY CHECK HERE IS A TRUE INVARIANT, NOT A REMEMBERED NUMBER. In particular
# `send_up == accept + duplicates` is deliberately NOT asserted: runDeliveryEvents
# also runs the transmit events, so an arrival can be consumed by something other
# than a receive event.
#
#   [SCA=<file>] ./invariants.sh [config] [sim-time]      defaults: Parent 300s
#
# EXIT: 0 all green, 1 at least one red, 3 the run itself failed.
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"

CFG=${1:-Parent}; T=${2:-300s}
if [ -z "$SCA" ]; then
  OUT=.inv
  rm -rf "$OUT"; mkdir -p "$OUT"
  ./out/clang-release/$(basename "$PWD").exe -u Cmdenv -c "$CFG" -n ".;../inet4.5/src" \
    --sim-time-limit="$T" --result-dir="$OUT" > "$OUT/run.log" 2>&1 \
    || { echo "BROKEN: run failed"; tail -20 "$OUT/run.log"; exit 3; }
  SCA=$(ls "$OUT"/*.sca | head -1)
fi
[ -n "$SCA" ] && [ -f "$SCA" ] || { echo "BROKEN: no .sca"; exit 3; }
CFG=$(grep -m1 '^attr configname' "$SCA" | awk '{print $3}')

NODES="sink sensor1 sensor2 sensor3 sensor4 sensor5 sensor6 sensor7 sensor8"
FAILED=0

# The control leaves, read off the STAGED module rather than named here. Empty is
# BROKEN, not green: no leaves means the battery would check nothing.
LEAVES=$(grep -oE 'bool try_create_[a-z]+Pkt\(\)' EbWsn.h | sed -E 's/bool try_create_([a-z]+)Pkt\(\)/\1/' | sort -u)
[ -n "$LEAVES" ] || { echo "BROKEN: no try_create_<leaf>Pkt in the staged EbWsn.h"; exit 3; }
created() { local s=0 l; for l in $LEAVES; do s=$((s + $(v "$1" "fired:create_${l}Pkt"))); done; echo "$s"; }

# scalar lookup; absent counter reads 0, which is what "the event never fired" means
v() { local x; x=$(grep -E "^scalar SensorScopeNetwork\.$1\.generic\.np $2 " "$SCA" \
       | awk '{print $4}' | head -1); echo "${x:-0}"; }
m() { local x; x=$(grep -E "^scalar SensorScopeNetwork\.$1\.wlan\[0\]\.mac $2 " "$SCA" \
       | awk '{print $4}' | head -1); echo "${x:-0}"; }
# ⚠ The queue records its scalars as `<name>:count`, not `<name>`.
q() { local x; x=$(grep -E "^scalar SensorScopeNetwork\.$1\.wlan\[0\]\.queue $2:count " "$SCA" \
       | awk '{print $4}' | head -1); echo "${x:-0}"; }

chk() { # chk <name> <node> <lhs> <op> <rhs> <detail>
  local ok
  case "$4" in
    "==") [ "$3" -eq "$5" ] && ok=1 ;;
    "<=") [ "$3" -le "$5" ] && ok=1 ;;
    ">=") [ "$3" -ge "$5" ] && ok=1 ;;
  esac
  if [ -z "$ok" ]; then
    printf "  RED   %-28s %-8s %s\n" "$1" "$2" "$6"
    FAILED=1
  fi
}

echo "config=$CFG  leaves=$(echo $LEAVES)  sca=$SCA"
echo "--- per-node invariants ---"
for n in $NODES; do
  orig=$(created "$n")
  stx=$(v "$n" fired:start_tx_controlPkt); sdn=$(v "$n" fired:send_down)
  acc=$(v "$n" fired:receive_controlPkt);  dup=$(v "$n" fired:receive_dup_controlPkt)
  fwd=$(v "$n" fired:fwdr_receive_pkt);    dst=$(v "$n" fired:dest_recv_pkt)
  clr=$(v "$n" fired:clear_recvdBuff)
  mrx=$(m "$n" nbRxDataPackets)
  drop=$(q "$n" droppedPacketsQueueOverflow)
  inq=$(q "$n" incomingPackets);           outq=$(q "$n" outgoingPackets)
  # I1  every transmit attempt is either an origination or a forward.
  chk "I1 tx=origin+forward" "$n" "$stx" "==" "$((orig+fwd))" "start_tx=$stx  created+fwdr=$((orig+fwd))"
  # I2  a node forwards at most once per packet it accepted, never more.
  chk "I2 fwdr<=accept" "$n" "$fwd" "<=" "$acc" "fwdr=$fwd accept=$acc"
  # I3  nothing leaves that was not queued to leave.
  chk "I3 send_down<=start_tx" "$n" "$sdn" "<=" "$stx" "send_down=$sdn start_tx=$stx"
  # I4  every send_down puts exactly one packet into the interface queue, and
  #     nothing else does (what the MAC does after the hand-off is its own).
  chk "I4 queue_in==send_down" "$n" "$inq" "==" "$sdn" "queue_in=$inq send_down=$sdn"
  # I5  the model cannot consume more frames than the radio decoded.
  chk "I5 accept+dup<=macRx" "$n" "$((acc+dup))" "<=" "$mrx" "accept+dup=$((acc+dup)) macRx=$mrx"
  # I6  a packet cannot be both forwarded and consumed as destination.
  chk "I6 fwdr+dest<=accept" "$n" "$((fwd+dst))" "<=" "$acc" "fwdr+dest=$((fwd+dst)) accept=$acc"
  # I7  the receive buffer is cleared at most once per accepted packet.
  chk "I7 clear<=accept" "$n" "$clr" "<=" "$acc" "clear=$clr accept=$acc"
  # I8  the interface queue conserves: in == out + dropped + still queued.
  chk "I8 queue conserves" "$n" "$inq" ">=" "$((outq+drop))" "in=$inq out=$outq dropped=$drop"
done

echo "--- whole-network invariants ---"
p() { grep -E "^par SensorScopeNetwork\.$1\.generic\.np $2 " "$SCA" | awk '{print $4}' | head -1; }
isSecs() { [[ "$1" =~ ^[0-9]+(\.[0-9]+)?s$ ]]; }
T=$(grep -m1 '^config sim-time-limit' "$SCA" | awk '{print $3}')
isSecs "$T" || { echo "BROKEN: cannot read sim-time-limit '$T' as seconds"; exit 3; }
DESTS=""; ORIGS=""
for n in $NODES; do
  case "$(p "$n" inDests)" in
    true)  DESTS="$DESTS $n" ;;
    false) ORIGS="$ORIGS $n" ;;
    *) echo "BROKEN: no inDests parameter recorded for $n"; exit 3 ;;
  esac
done
for l in $LEAVES; do
  # I9a every node outside Dests whose timer for the type is ARMED originates the
  #     same number of it, within one (only the random first fire differs).
  lo=""; hi=""; per=""
  for n in $ORIGS; do
    iv=$(p "$n" "${l}FloodsInterval")
    [ "$(awk -v i="${iv%s}" 'BEGIN { print (i > 0) ? 1 : 0 }')" = 1 ] || continue
    c=$(v "$n" "fired:create_${l}Pkt"); per="$per $n=$c"
    { [ -z "$lo" ] || [ "$c" -lt "$lo" ]; } && lo=$c
    { [ -z "$hi" ] || [ "$c" -gt "$hi" ]; } && hi=$c
  done
  [ -n "$lo" ] && chk "I9a $l even across armed" "all" "$((hi - lo))" "<=" "1" "$l:$per"
  # I9b no node originates more of a type than its own timer can fire in the
  #     run: floor(T / interval); 0 when the timer is off.
  for n in $NODES; do
    iv=$(p "$n" "${l}FloodsInterval")
    isSecs "$iv" || { echo "BROKEN: no ${l}FloodsInterval in seconds recorded for $n (got '$iv')"; exit 3; }
    cap=$(awk -v t="${T%s}" -v i="${iv%s}" 'BEGIN { print (i > 0) ? int(t / i) : 0 }')
    chk "I9b $l <= T/interval" "$n" "$(v "$n" "fired:create_${l}Pkt")" "<=" "$cap" \
        "created=$(v "$n" "fired:create_${l}Pkt") cap=$cap (T=$T interval=$iv)"
  done
done
# I10 a destination consumes and does not forward.
for n in $DESTS; do
  chk "I10 dest originates 0" "$n" "$(created "$n")" "==" "0" "-"
  chk "I10 dest forwards 0"   "$n" "$(v "$n" fired:fwdr_receive_pkt)" "==" "0" "-"
  chk "I10 dest macTx 0"      "$n" "$(m "$n" nbTxDataPackets)" "==" "0" "-"
done

[ "$FAILED" -eq 0 ] && { echo "GREEN: all invariants hold"; exit 0; }
echo "RED: at least one invariant broke"
exit 1
