#!/bin/bash
# Invariant battery for structure 4 with the AODV split, on the old nine-node
# field: ../v4_mintroute's battery, restated for the AODV test code (plan §8,
# design/V4_AODV_Plan.md). Three things differ from MintRoute, each because
# the test code acts outside the model:
#   - I4: RREPs, HELLOs and RERRs are sent by the test code straight to the
#     interface queue (sendAODVPacket, sendAODVBroadcast), not through the
#     model's send_down, so the queue receives send_down + RREPs sent + RREPs
#     forwarded + HELLOs sent + RERRs sent (aodv:rrepSent, rrepForwarded,
#     helloSent, rerrSent; all read 0 when aodv is false, and the last two
#     when useHelloMessages is false and nothing breaks).
#   - I5: an RREP, HELLO or RERR the radio decodes reaches the test code, not
#     the model, so accept + dup + RREPs + HELLOs + RERRs received <= MAC Rx.
#     (SMAC counts every decoded data frame before its address test, so
#     overheard unicasts only add to MAC Rx; a failed node's MAC keeps counting
#     what its routing drops.)
#   - I9a (originations even across nodes) applies only where aodv is false: with
#     the test code a node starts a discovery only when it has no route, so the
#     counts differ by design. I9b's cap gains the retries: each discovery sends
#     at most 1 + rreqRetries RREQs (handleWaitForRREP), so a node creates at
#     most floor(T / interval) x (1 + rreqRetries) of the type its discovery
#     uses (rreq); RREP and RRER keep floor(T / interval), 0 with the timer off.
# Dests is empty here (A1: the sink is outside), so I10 checks no node.
#
# ⚠ EVERY CHECK HERE IS A TRUE INVARIANT, NOT A REMEMBERED NUMBER.
#
#   [SCA=<file>] ./invariants.sh [config] [sim-time] [run]   defaults: Route360 360s 0
#
# Run from the OMNeT++ MSYS2 CLANG64 shell (see build.sh).
# EXIT: 0 all green, 1 at least one red, 3 the run itself failed.
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"

CFG=${1:-Route360}; T=${2:-360s}; RUN=${3:-0}
if [ -z "$SCA" ]; then
  OUT=.inv
  rm -rf "$OUT"; mkdir -p "$OUT"
  ./out/clang-release/$(basename "$PWD").exe -u Cmdenv -c "$CFG" -r "$RUN" -n ".;../inet4.5/src" \
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
echo "$LEAVES" | grep -qx rreq || { echo "BROKEN: no rreq leaf -- not the AODV split"; exit 3; }
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
  rps=$(v "$n" aodv:rrepSent); rpf=$(v "$n" aodv:rrepForwarded); rpr=$(v "$n" aodv:rrepReceived)
  hls=$(v "$n" aodv:helloSent); hlr=$(v "$n" aodv:helloReceived)
  ers=$(v "$n" aodv:rerrSent);  err=$(v "$n" aodv:rerrReceived)
  mrx=$(m "$n" nbRxDataPackets)
  drop=$(q "$n" droppedPacketsQueueOverflow)
  inq=$(q "$n" incomingPackets);           outq=$(q "$n" outgoingPackets)
  # I1  every transmit attempt is either an origination or a forward.
  chk "I1 tx=origin+forward" "$n" "$stx" "==" "$((orig+fwd))" "start_tx=$stx  created+fwdr=$((orig+fwd))"
  # I2  a node forwards at most once per packet it accepted, never more.
  chk "I2 fwdr<=accept" "$n" "$fwd" "<=" "$acc" "fwdr=$fwd accept=$acc"
  # I3  nothing leaves that was not queued to leave.
  chk "I3 send_down<=start_tx" "$n" "$sdn" "<=" "$stx" "send_down=$sdn start_tx=$stx"
  # I4  the queue receives exactly the model's send_downs and the test code's
  #     RREPs, HELLOs and RERRs, nothing else.
  chk "I4 queue_in==sdn+aodv" "$n" "$inq" "==" "$((sdn+rps+rpf+hls+ers))" "queue_in=$inq send_down=$sdn rrepSent=$rps rrepForwarded=$rpf helloSent=$hls rerrSent=$ers"
  # I5  neither the model nor the test code consumes more frames than the radio decoded.
  chk "I5 acc+dup+aodv<=macRx" "$n" "$((acc+dup+rpr+hlr+err))" "<=" "$mrx" "accept+dup=$((acc+dup)) rrepReceived=$rpr helloReceived=$hlr rerrReceived=$err macRx=$mrx"
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
  case "$(p "$n" aodv)" in
    true|false) ;;
    *) echo "BROKEN: no aodv parameter recorded for $n"; exit 3 ;;
  esac
done
for l in $LEAVES; do
  # I9a where aodv is false, every node outside Dests whose timer for the type is
  #     ARMED originates the same number of it, within one.
  lo=""; hi=""; per=""
  for n in $ORIGS; do
    [ "$(p "$n" aodv)" = false ] || continue
    iv=$(p "$n" "${l}FloodsInterval")
    [ "$(awk -v i="${iv%s}" 'BEGIN { print (i > 0) ? 1 : 0 }')" = 1 ] || continue
    c=$(v "$n" "fired:create_${l}Pkt"); per="$per $n=$c"
    { [ -z "$lo" ] || [ "$c" -lt "$lo" ]; } && lo=$c
    { [ -z "$hi" ] || [ "$c" -gt "$hi" ]; } && hi=$c
  done
  [ -n "$lo" ] && chk "I9a $l even across armed" "all" "$((hi - lo))" "<=" "1" "$l:$per"
  # I9b no node originates more of a type than its own timer can fire in the run
  #     (floor(T / interval), 0 with the timer off), times 1 + rreqRetries for
  #     the RREQ when the test code's retries are on.
  for n in $NODES; do
    iv=$(p "$n" "${l}FloodsInterval")
    isSecs "$iv" || { echo "BROKEN: no ${l}FloodsInterval in seconds recorded for $n (got '$iv')"; exit 3; }
    mult=1
    if [ "$l" = rreq ] && [ "$(p "$n" aodv)" = true ]; then
      r=$(p "$n" rreqRetries)
      [[ "$r" =~ ^[0-9]+$ ]] || { echo "BROKEN: no rreqRetries recorded for $n (got '$r')"; exit 3; }
      mult=$((1 + r))
    fi
    cap=$(awk -v t="${T%s}" -v i="${iv%s}" -v k="$mult" 'BEGIN { print (i > 0) ? int(t / i) * k : 0 }')
    chk "I9b $l <= cap" "$n" "$(v "$n" "fired:create_${l}Pkt")" "<=" "$cap" \
        "created=$(v "$n" "fired:create_${l}Pkt") cap=$cap (T=$T interval=$iv x$mult)"
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
