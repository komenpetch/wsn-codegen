#!/bin/bash
# Invariant battery for structure 3 on the nine-node field.
#
# This is a bug-HUNTING loop rather than a bug-REPRODUCING one: there is no
# known symptom, so instead of asserting one failure it asserts the flood's
# conservation laws and reports which of them break. Red on any of them is a
# defect or a wrong assumption, and either is worth knowing.
#
# ⚠ EVERY CHECK HERE IS A TRUE INVARIANT, NOT A REMEMBERED NUMBER. Pinning
# counters from a previous run would go red on any harness change and prove
# nothing; these hold for any topology, rate and link, so a red is about the
# module. In particular `send_up == accept + duplicates` is deliberately NOT
# asserted -- this project already over-read that once: runDeliveryEvents also
# runs the transmit events, so an arrival can be consumed by something other
# than a receive event. It was never a conservation law.
#
# EXIT: 0 all green, 1 at least one red, 3 the run itself failed.
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"

CFG=${CFG:-Sink}
OUT=.inv
rm -rf "$OUT"; mkdir -p "$OUT"

./out/clang-release/v3_net.exe -u Cmdenv -c "$CFG" -n ".;../inet4.5/src" \
  --sim-time-limit=60s --result-dir="$OUT" > "$OUT/run.log" 2>&1 \
  || { echo "BROKEN: run failed"; tail -20 "$OUT/run.log"; exit 3; }

SCA=$(ls "$OUT"/*.sca | head -1)
[ -n "$SCA" ] || { echo "BROKEN: no .sca"; exit 3; }
[ "$(grep -m1 '^attr configname' "$SCA" | awk '{print $3}')" = "$CFG" ] \
  || { echo "BROKEN: wrong config"; exit 3; }

NODES="sink sensor1 sensor2 sensor3 sensor4 sensor5 sensor6 sensor7 sensor8"
FAILED=0

# scalar lookup; absent counter reads 0, which is what "the event never fired" means
v() { local x; x=$(grep -E "^scalar SensorScopeNetwork\.$1\.generic\.np $2 " "$SCA" \
       | awk '{print $4}' | head -1); echo "${x:-0}"; }
m() { local x; x=$(grep -E "^scalar SensorScopeNetwork\.$1\.wlan\[0\]\.mac $2 " "$SCA" \
       | awk '{print $4}' | head -1); echo "${x:-0}"; }
# ⚠ The queue records its scalars as `<name>:count`, not `<name>`. The bare name
# matched nothing, every lookup read 0, and I4 went red on all eight sensors at
# once -- a whole-battery red is almost always the harness, not the code.
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

echo "config=$CFG"
echo "--- per-node invariants ---"
tRoute=0; tBeacon=0
for n in $NODES; do
  route=$(v "$n" fired:create_routePkt);   beacon=$(v "$n" fired:create_beaconPkt)
  stx=$(v "$n" fired:start_tx_controlPkt); sdn=$(v "$n" fired:send_down)
  acc=$(v "$n" fired:receive_controlPkt);  dup=$(v "$n" fired:receive_dup_controlPkt)
  fwd=$(v "$n" fired:fwdr_receive_pkt);    dst=$(v "$n" fired:dest_recv_pkt)
  clr=$(v "$n" fired:clear_recvdBuff)
  mtx=$(m "$n" nbTxDataPackets);           mrx=$(m "$n" nbRxDataPackets)
  drop=$(q "$n" droppedPacketsQueueOverflow)
  inq=$(q "$n" incomingPackets);           outq=$(q "$n" outgoingPackets)
  tRoute=$((tRoute+route)); tBeacon=$((tBeacon+beacon))

  # I1  every transmit attempt is either an origination or a forward.
  chk "I1 tx=origin+forward" "$n" "$stx" "==" "$((route+beacon+fwd))" \
      "start_tx=$stx  route+beacon+fwdr=$((route+beacon+fwd))"
  # I2  a node forwards at most once per packet it accepted, never more.
  chk "I2 fwdr<=accept" "$n" "$fwd" "<=" "$acc" "fwdr=$fwd accept=$acc"
  # I3  nothing leaves that was not queued to leave.
  chk "I3 send_down<=start_tx" "$n" "$sdn" "<=" "$stx" "send_down=$sdn start_tx=$stx"
  # I4  every send_down firing puts exactly one packet into the interface queue,
  #     and nothing else does.
  #
  # ⚠ THIS WAS `macTx <= send_down` AND THAT WAS WRONG, not the module. It went
  # red on sensor1 (macTx 78, send_down 70) and the queue counters settled it:
  # 70 in, 70 out, 0 dropped -- the module handed down exactly 70. SMAC re-sent
  # 8 of them (nbContendFail 866 on that node; sendData() dup()s currentTxFrame
  # and the contention path can re-enter PROTO_SEND_DATA on a frame already
  # dequeued). What the MAC does after the hand-off is not this module's
  # invariant; what it hands down is.
  chk "I4 queue_in==send_down" "$n" "$inq" "==" "$sdn" \
      "queue_in=$inq send_down=$sdn  (macTx=$mtx is the MAC's own business)"
  # I5  the model cannot consume more frames than the radio decoded.
  chk "I5 accept+dup<=macRx" "$n" "$((acc+dup))" "<=" "$mrx" \
      "accept+dup=$((acc+dup)) macRx=$mrx"
  # I6  a packet cannot be both forwarded and consumed as destination.
  chk "I6 fwdr+dest<=accept" "$n" "$((fwd+dst))" "<=" "$acc" \
      "fwdr+dest=$((fwd+dst)) accept=$acc"
  # I7  the receive buffer is cleared at most once per accepted packet.
  chk "I7 clear<=accept" "$n" "$clr" "<=" "$acc" "clear=$clr accept=$acc"
  # I8  the interface queue conserves: in == out + dropped + still queued.
  chk "I8 queue conserves" "$n" "$inq" ">=" "$((outq+drop))" \
      "in=$inq out=$outq dropped=$drop"
done

echo "--- whole-network invariants ---"
# I9  both control leaves originate on the same tick, so their totals match.
chk "I9 route==beacon total" "all" "$tRoute" "==" "$tBeacon" \
    "route=$tRoute beacon=$tBeacon"
# I10 a destination consumes and does not forward (this config names the sink).
if [ "$CFG" = "Sink" ]; then
  chk "I10 sink originates 0" "sink" "$(v sink fired:create_routePkt)" "==" "0" "-"
  chk "I10 sink forwards 0"   "sink" "$(v sink fired:fwdr_receive_pkt)" "==" "0" "-"
  chk "I10 sink macTx 0"      "sink" "$(m sink nbTxDataPackets)" "==" "0" "-"
fi

[ "$FAILED" -eq 0 ] && { echo "GREEN: all invariants hold"; exit 0; }
echo "RED: at least one invariant broke"
exit 1
