# Machine-Only Event-B → C++ Mapping (per Interface)

**Automatic Code Generation Framework from Event-B Models for WSNs**
**Komen Nitchaphon — 6630613042**
**Date:** 2026-06-29 · **Version:** 1.0

**Machine-only** extraction from the full per-interface mapping tables (not published separately):
the six interfaces' **machine** parts — state variables (from the machine invariants) and
events (guards/actions) → C++. The **context** part (carrier sets / constants / axioms →
C++ types) has been removed; this file is the input for inducing the translation rules in
the next step.

Source = raw Rodin XML `Ex_WSN_Pattern/WSN_Pattern_shDecom6_2/I*.bum`. Pure typing guards
(`pkt ∈ PKT`, `x ∈ ℤ`, `sf ∈ BOOL`) are omitted. Context-provided names — `Node`, `PktId`,
`Data` (`= int`), `PktType`, and the constants `ND`, `Dests`, `type`, `initialSrcAddr`,
`finalDestAddr` — are **referenced but defined elsewhere** (the context mapping), since this
document deliberately excludes the context.

**Abbreviation:** `any_of(R, second==y)` = `std::any_of(R.begin(), R.end(), [&](auto& p){ return p.second==y; })` (and `first==x` over `p.first`).

---

## 1. ISend

*State:* `sentUp, sentDown : std::set<std::pair<Node,PktId>>` · `ctlNeighbours : std::map<PktId,std::set<Node>>`

| Event-B | C++ | Reason |
|---|---|---|
| `init  sentUp, sentDown, ctlNeighbours := ∅` | `sentUp.clear(); sentDown.clear(); ctlNeighbours.clear();` | the empty relation is the empty container. |
| `start_tx  @g2 x↦pkt ∉ sentDown` | `sentDown.count({x,pkt}) == 0` | a relation *is* its set of pairs, so pair-membership is element `count`. |
| `start_tx  @g3 x↦pkt ∉ sentUp` | `sentUp.count({x,pkt}) == 0` | pair non-membership over the pair-set. |
| `start_tx  @a1 sentDown := sentDown ∪ {x↦pkt}` | `sentDown.insert({x,pkt});` | union with a single pair = insert that pair. |
| `send_down  @g2 x↦pkt ∈ sentDown` | `bool enabled = sentDown.count({x,pkt}) > 0;` | pair membership; the event has no action, so it is only an enabling condition. |
| `send_up  @g2 x↦pkt ∉ sentUp` | `sentUp.count({x,pkt}) == 0` | pair non-membership. |
| `send_up  @g3 x↦pkt ∈ sentDown` | `sentDown.count({x,pkt}) > 0` | pair membership. |
| `send_up  @g4 pkt ∉ dom(ctlNeighbours)` | `ctlNeighbours.count(pkt) == 0` | no neighbour set is stored under key `pkt` (absent key = none). |
| `send_up  @g5 nbrs ≠ ∅` | `!nbrs.empty()` | non-empty set test. |
| `send_up  @a1 ctlNeighbours := ctlNeighbours ∪ ({pkt}×nbrs)` | `for (Node n : nbrs) ctlNeighbours[pkt].insert(n);` | `{pkt}×nbrs` joins `pkt` to every neighbour → insert each into `pkt`'s set. |
| `send_up  @a2 sentDown := sentDown ∖ {x↦pkt}` | `sentDown.erase({x,pkt});` | difference by a single pair = erase that pair. |
| `send_up  @a3 sentUp := sentUp ∪ {x↦pkt}` | `sentUp.insert({x,pkt});` | union with a single pair = insert. |
| `receive  @g1 nb↦pkt ∉ sentUp` | `sentUp.count({nb,pkt}) == 0` | pair non-membership. |
| `receive  @g2 nb↦pkt ∉ sentDown` | `sentDown.count({nb,pkt}) == 0` | pair non-membership. |
| `receive  @a1 ctlNeighbours := ctlNeighbours ∖ {pkt↦nb}` | `ctlNeighbours[pkt].erase(nb); if (ctlNeighbours[pkt].empty()) ctlNeighbours.erase(pkt);` | remove `nb` from `pkt`'s set; drop the key when its set empties. |
| `finish_tx_pkt  @g2 {pkt}◁ctlNeighbours = ∅` | `ctlNeighbours.count(pkt) == 0 \|\| ctlNeighbours.at(pkt).empty()` | restriction-to-`pkt` is empty iff no values are stored under `pkt`. |
| `finish_tx_pkt  @g3 pkt ∈ ran(sentUp) ∧ pkt ∉ ran(sentDown)` | `any_of(sentUp, second==pkt) && !any_of(sentDown, second==pkt)` | range = set of second components; scan the pairs. |
| `finish_tx_pkt  @g4 x ∈ dom(sentUp)` | `any_of(sentUp, first==x)` | domain = set of first components; scan the pairs. |
| `finish_tx_pkt  @g5 x↦pkt ∈ sentUp` | `sentUp.count({x,pkt}) > 0` | pair membership. |
| `finish_tx_pkt  @a1 sentUp := sentUp ∖ {x↦pkt}` | `sentUp.erase({x,pkt});` | erase one pair. |
| `final_tx_pkt  @g2 {pkt}◁ctlNeighbours = ∅` | `ctlNeighbours.count(pkt) == 0 \|\| ctlNeighbours.at(pkt).empty()` | no values stored under `pkt`. |
| `final_tx_pkt  @g3 pkt ∈ ran(sentUp) ∧ pkt ∉ ran(sentDown)` | `any_of(sentUp, second==pkt) && !any_of(sentDown, second==pkt)` | range scan over pairs. |
| `final_tx_pkt  @a1 sentUp := sentUp ⩥ {pkt}` | `for (auto it=sentUp.begin(); it!=sentUp.end(); ) it->second==pkt ? it=sentUp.erase(it) : ++it;` | range subtraction keeps pairs whose packet ≠ `pkt`, i.e. delete those equal to `pkt`. |

---

## 2. IReceive

*State:* `recvBuff, clrRecvBuffFlg : std::set<std::pair<Node,PktId>>`

| Event-B | C++ | Reason |
|---|---|---|
| `init  recvBuff, clrRecvBuffFlg := ∅` | `recvBuff.clear(); clrRecvBuffFlg.clear();` | empty relation = empty container. |
| `receive  @g2 nb↦pkt ∉ recvBuff` | `recvBuff.count({nb,pkt}) == 0` | pair non-membership over the pair-set. |
| `receive  @a1 recvBuff := recvBuff ∪ {nb↦pkt}` | `recvBuff.insert({nb,pkt});` | union with one pair = insert. |
| `clear_recvdBuff  @g2 nb↦pkt ∈ recvBuff` | `recvBuff.count({nb,pkt}) > 0` | pair membership. |
| `clear_recvdBuff  @g3 nb↦pkt ∈ clrRecvBuffFlg` | `clrRecvBuffFlg.count({nb,pkt}) > 0` | pair membership. |
| `clear_recvdBuff  @a1 recvBuff := recvBuff ∖ {nb↦pkt}` | `recvBuff.erase({nb,pkt});` | difference by one pair = erase. |
| `fwdr_receive_pkt  @g2 nb↦pkt ∈ recvBuff` | `recvBuff.count({nb,pkt}) > 0` | pair membership. |
| `fwdr_receive_pkt  @g3 nb↦pkt ∉ clrRecvBuffFlg` | `clrRecvBuffFlg.count({nb,pkt}) == 0` | pair non-membership. |
| `fwdr_receive_pkt  @g4 nb ∉ Dests` | `Dests.count(nb) == 0` | membership test on the constant destination set. |
| `fwdr_receive_pkt  @a1 clrRecvBuffFlg := clrRecvBuffFlg ∪ {nb↦pkt}` | `clrRecvBuffFlg.insert({nb,pkt});` | union with one pair = insert. |
| `dest_recv_pkt  @g2 nb↦pkt ∈ recvBuff` | `recvBuff.count({nb,pkt}) > 0` | pair membership. |
| `dest_recv_pkt  @g3 nb ∈ Dests` | `Dests.count(nb) > 0` | membership on the destination set. |
| `dest_recv_pkt  @g4 nb↦pkt ∉ clrRecvBuffFlg` | `clrRecvBuffFlg.count({nb,pkt}) == 0` | pair non-membership. |
| `dest_recv_pkt  @a1 clrRecvBuffFlg := clrRecvBuffFlg ∪ {nb↦pkt}` | `clrRecvBuffFlg.insert({nb,pkt});` | union with one pair = insert. |

---

## 3. INDBuffer

*State:* `ndBuff : std::set<std::pair<Node,PktId>>`

| Event-B | C++ | Reason |
|---|---|---|
| `init  ndBuff := ∅` | `ndBuff.clear();` | empty relation = empty container. |
| `creatingPkt  @g1 x ∈ ND ∖ Dests` | `ND.count(x) > 0 && Dests.count(x) == 0` | set-difference membership = in `ND` and not in `Dests`. |
| `creatingPkt  @g2 x = initialSrcAddr(pkt)` | `x == initialSrcAddr.at(pkt)` | function application: one stored image per packet. |
| `creatingPkt  @g2 des = ran({pkt}◁finalDestAddr)` | `des == finalDestAddr.at(pkt)` | the values related to key `pkt` = the set stored at `pkt`. |
| `creatingPkt  @g3 x↦pkt ∉ ndBuff` | `ndBuff.count({x,pkt}) == 0` | pair non-membership. |
| `creatingPkt  @a1 ndBuff := ndBuff ∪ {x↦pkt}` | `ndBuff.insert({x,pkt});` | union with one pair = insert. |
| `start_tx  @g2 x↦pkt ∈ ndBuff` | `ndBuff.count({x,pkt}) > 0` | pair membership. |
| `start_tx  @a1 ndBuff := ndBuff ∖ {x↦pkt}` | `ndBuff.erase({x,pkt});` | difference by one pair = erase. |
| `fwdr_receive_pkt  @g4 nb ∉ Dests` | `Dests.count(nb) == 0` | membership on the destination set. |
| `fwdr_receive_pkt  @g1 nb↦pkt ∉ ndBuff` | `ndBuff.count({nb,pkt}) == 0` | pair non-membership. |
| `fwdr_receive_pkt  @a1 ndBuff := ndBuff ∪ {nb↦pkt}` | `ndBuff.insert({nb,pkt});` | union with one pair = insert. |
| `finish_tx_pkt  @g2 pkt ∈ ran(ndBuff)` | `any_of(ndBuff, second==pkt)` | range membership; scan the pairs. Guard-only → enabling condition. |
| `final_tx_pkt  @g1 pkt ∉ ran(ndBuff)` | `!any_of(ndBuff, second==pkt)` | range non-membership: the packet has left every buffer. |

---

## 4. IDestBuffer

*State:* `destBuff : std::set<std::pair<Node,PktId>>`

| Event-B | C++ | Reason |
|---|---|---|
| `init  destBuff := ∅` | `destBuff.clear();` | empty relation = empty container. |
| `dest_recv_pkt  @g3 nb ∈ Dests` | `Dests.count(nb) > 0` | only destination nodes deliver into `destBuff`. |
| `dest_recv_pkt  @g1 nb↦pkt ∉ destBuff` | `destBuff.count({nb,pkt}) == 0` | pair non-membership. |
| `dest_recv_pkt  @a1 destBuff := destBuff ∪ {nb↦pkt}` | `destBuff.insert({nb,pkt});` | union with one pair = insert. |

---

## 5. ISensingUnit

*State:* `ctlSensedFlg : std::map<Node,bool>` · `senseBuff : std::map<Node,std::set<Data>>`

| Event-B | C++ | Reason |
|---|---|---|
| `init  ctlSensedFlg := (ND∖Dests)×{FALSE}` | `for (Node n : ND) if (Dests.count(n)==0) ctlSensedFlg[n] = false;` | total-function init: each source node paired with the constant `FALSE`. |
| `init  senseBuff := (ND∖Dests)×{∅}` | `for (Node n : ND) if (Dests.count(n)==0) senseBuff[n] = {};` | each source node starts with an empty reading-set. |
| `sensing  @g1 x ∈ ND ∖ Dests` | `ND.count(x) > 0 && Dests.count(x) == 0` | set-difference membership. |
| `sensing  @g4 x ∈ dom(ctlSensedFlg) ∧ ctlSensedFlg(x) = FALSE` | `ctlSensedFlg.count(x) > 0 && ctlSensedFlg.at(x) == false` | key present and its single boolean image is false. |
| `sensing  @a1 ctlSensedFlg(x) := sf` | `ctlSensedFlg[x] = sf;` | function update sets the one image of `x`. |
| `sensing  @a2 senseBuff(x) := senseBuff(x) ∪ {data}` | `senseBuff[x].insert(data);` | insert a reading into node `x`'s set. |
| `creatingDataPacket  @g1 x ∈ ND ∖ Dests` | `ND.count(x) > 0 && Dests.count(x) == 0` | set-difference membership. |
| `creatingDataPacket  @g2 x = initialSrcAddr(pkt)` | `x == initialSrcAddr.at(pkt)` | function application. |
| `creatingDataPacket  @g2 des = ran({pkt}◁finalDestAddr)` | `des == finalDestAddr.at(pkt)` | values related to key `pkt` = set stored at `pkt`. |
| `creatingDataPacket  @g3 type(pkt) = DATA` | `type.at(pkt) == PktType::DATA` | function application into the type enum. |
| `creatingDataPacket  @g4 senseBuff ≠ ∅ ∧ data ∈ senseBuff(x)` | `!senseBuff.empty() && senseBuff.count(x) > 0 && senseBuff.at(x).count(data) > 0` | whole-map non-empty, then membership in node `x`'s set. |
| `creatingDataPacket  @a1 senseBuff(x) := senseBuff(x) ∖ {data}` | `senseBuff[x].erase(data);` | remove the reading consumed into the packet. |

---

## 6. IPacket

*State:* `pktFwdr : std::map<PktId,Node>` · `pktData : std::map<PktId,Data>` · `createdPkts : std::set<PktId>`

| Event-B | C++ | Reason |
|---|---|---|
| `init  pktFwdr, pktData, createdPkts := ∅` | `pktFwdr.clear(); pktData.clear(); createdPkts.clear();` | empty function/set = empty container. |
| `creatingPkt  @g1 x ∈ ND ∖ Dests` | `ND.count(x) > 0 && Dests.count(x) == 0` | set-difference membership. |
| `creatingPkt  @g2 x = initialSrcAddr(pkt)` | `x == initialSrcAddr.at(pkt)` | function application. |
| `creatingPkt  @g2 des = ran({pkt}◁finalDestAddr)` | `des == finalDestAddr.at(pkt)` | values related to key `pkt` = set stored at `pkt`. |
| `creatingPkt  @g3 pkt ∉ dom(pktFwdr)` | `pktFwdr.count(pkt) == 0` | a key is in the domain iff it has an entry. |
| `creatingPkt  @g4 pkt ∉ dom(pktData)` | `pktData.count(pkt) == 0` | domain membership = has an entry. |
| `creatingPkt  @a1 createdPkts := createdPkts ∪ {pkt}` | `createdPkts.insert(pkt);` | union with a singleton = insert. |
| `creatingPkt  @a2 pktFwdr := pktFwdr ∪ {pkt↦x}` | `pktFwdr[pkt] = x;` | adding a pair on a fresh key extends the function. |
| `creatingPkt  @a3 pktData := pktData ∪ {pkt↦data}` | `pktData[pkt] = data;` | extend the payload function on `pkt`. |
| `start_tx  @g1 pkt ∈ dom(pktFwdr)` | `pktFwdr.count(pkt) > 0` | domain membership = has an entry. |
| `start_tx  @a1 pktFwdr := pktFwdr ⊴ {pkt↦x}` † | `pktFwdr[pkt] = x;` | relational override replaces the one image of `pkt`. |

† The raw XML for `MPacket_set_pktFwdr_a2` shows `pktFwdr ≔ pktFwdr  {pkt↦x}` with the
override glyph (`⊴`) **not rendered**; the label "set_pktFwdr" and guard `pkt ∈ dom(pktFwdr)`
confirm a relational override. Flag for the advisor if a different operator was intended.

---

## 7. Whole-Machine Translation (Machine → C++)

This section assembles each interface's **machine** into one C++ unit: its state variables
plus its events, each event rendered as a **guarded atomic method** (guards → early
`return false`, actions → body, guard-only events → `bool` predicate). The context
types/constants the methods use (`Node`, `PktId`, `Data`, `PktType`, `ND`, `Dests`, `type`,
`initialSrcAddr`, `finalDestAddr`) are provided by the context mapping, not redefined here.

### Machine-side helpers (used by the classes below)
```cpp
// pair-set domain / range tests (a relation keeps no separate key index)
template<class R> bool inDom(const R& r, Node x){ return std::any_of(r.begin(),r.end(),[&](auto&p){return p.first==x;}); }
template<class R> bool inRan(const R& r, PktId y){ return std::any_of(r.begin(),r.end(),[&](auto&p){return p.second==y;}); }
```

### 7.1 ISend
*Machine state:* `sentUp`, `sentDown`, `ctlNeighbours`.
```cpp
class ISend {
  std::set<std::pair<Node,PktId>> sentUp, sentDown;   // sentUp, sentDown ∈ ND ↔ PKT
  std::map<PktId,std::set<Node>> ctlNeighbours;       // ctlNeighbours ∈ PKT ↔ ND
public:
  ISend(){ sentUp.clear(); sentDown.clear(); ctlNeighbours.clear(); }   // INITIALISATION := ∅

  bool start_tx(Node x, PktId pkt){
    if (sentDown.count({x,pkt}) || sentUp.count({x,pkt})) return false;   // g2, g3
    sentDown.insert({x,pkt});                                            // a1
    return true;
  }
  bool send_down(Node x, PktId pkt){                                      // guard-only
    return sentDown.count({x,pkt}) > 0;                                   // g2
  }
  bool send_up(Node x, PktId pkt, const std::set<Node>& nbrs){
    if (sentUp.count({x,pkt}) || !sentDown.count({x,pkt})) return false;  // g2, g3
    if (ctlNeighbours.count(pkt) || nbrs.empty()) return false;          // g4, g5
    for (Node n : nbrs) ctlNeighbours[pkt].insert(n);                    // a1
    sentDown.erase({x,pkt});                                             // a2
    sentUp.insert({x,pkt});                                              // a3
    return true;
  }
  bool receive(Node nb, PktId pkt){
    if (sentUp.count({nb,pkt}) || sentDown.count({nb,pkt})) return false; // g1, g2
    ctlNeighbours[pkt].erase(nb);                                         // a1
    if (ctlNeighbours[pkt].empty()) ctlNeighbours.erase(pkt);
    return true;
  }
  bool finish_tx_pkt(Node x, PktId pkt){
    bool ctlEmpty = ctlNeighbours.count(pkt)==0 || ctlNeighbours.at(pkt).empty();
    if (!ctlEmpty) return false;                                          // g2
    if (!inRan(sentUp,pkt) || inRan(sentDown,pkt)) return false;          // g3
    if (!inDom(sentUp,x) || !sentUp.count({x,pkt})) return false;         // g4, g5
    sentUp.erase({x,pkt});                                                // a1
    return true;
  }
  bool final_tx_pkt(PktId pkt){
    bool ctlEmpty = ctlNeighbours.count(pkt)==0 || ctlNeighbours.at(pkt).empty();
    if (!ctlEmpty) return false;                                          // g2
    if (!inRan(sentUp,pkt) || inRan(sentDown,pkt)) return false;          // g3
    for (auto it=sentUp.begin(); it!=sentUp.end(); )                      // a1: sentUp ⩥ {pkt}
      it->second==pkt ? it=sentUp.erase(it) : ++it;
    return true;
  }
};
```

### 7.2 IReceive
*Machine state:* `recvBuff`, `clrRecvBuffFlg`.
```cpp
class IReceive {
  std::set<std::pair<Node,PktId>> recvBuff, clrRecvBuffFlg;   // ∈ ND ↔ PKT
public:
  IReceive(){ recvBuff.clear(); clrRecvBuffFlg.clear(); }

  bool receive(Node nb, PktId pkt){
    if (recvBuff.count({nb,pkt})) return false;                // g2
    recvBuff.insert({nb,pkt});                                 // a1
    return true;
  }
  bool clear_recvdBuff(Node nb, PktId pkt){
    if (!recvBuff.count({nb,pkt}) || !clrRecvBuffFlg.count({nb,pkt})) return false; // g2, g3
    recvBuff.erase({nb,pkt});                                  // a1
    return true;
  }
  bool fwdr_receive_pkt(Node nb, PktId pkt){
    if (!recvBuff.count({nb,pkt}) || clrRecvBuffFlg.count({nb,pkt})) return false;  // g2, g3
    if (Dests.count(nb)) return false;                         // g4: nb ∉ Dests
    clrRecvBuffFlg.insert({nb,pkt});                           // a1
    return true;
  }
  bool dest_recv_pkt(Node nb, PktId pkt){
    if (!recvBuff.count({nb,pkt}) || clrRecvBuffFlg.count({nb,pkt})) return false;  // g2, g4
    if (!Dests.count(nb)) return false;                        // g3: nb ∈ Dests
    clrRecvBuffFlg.insert({nb,pkt});                           // a1
    return true;
  }
};
```

### 7.3 INDBuffer
*Machine state:* `ndBuff`.
```cpp
class INDBuffer {
  std::set<std::pair<Node,PktId>> ndBuff;                     // ∈ ND ↔ PKT
public:
  INDBuffer(){ ndBuff.clear(); }

  bool creatingPkt(Node x, const std::set<Node>& des, PktId pkt, Data /*data*/){
    if (!(ND.count(x) && !Dests.count(x))) return false;                          // g1: x ∈ ND∖Dests
    if (x != initialSrcAddr.at(pkt) || des != finalDestAddr.at(pkt)) return false; // g2
    if (ndBuff.count({x,pkt})) return false;                                      // g3
    ndBuff.insert({x,pkt});                                                       // a1
    return true;
  }
  bool start_tx(Node x, PktId pkt){
    if (!ndBuff.count({x,pkt})) return false;                  // g2
    ndBuff.erase({x,pkt});                                     // a1
    return true;
  }
  bool fwdr_receive_pkt(Node nb, PktId pkt){
    if (Dests.count(nb) || ndBuff.count({nb,pkt})) return false; // g4, g1
    ndBuff.insert({nb,pkt});                                     // a1
    return true;
  }
  bool finish_tx_pkt(Node /*x*/, PktId pkt){ return inRan(ndBuff,pkt); }  // g2 (guard-only)
  bool final_tx_pkt(PktId pkt){ return !inRan(ndBuff,pkt); }              // g1 (guard-only)
};
```

### 7.4 IDestBuffer
*Machine state:* `destBuff`.
```cpp
class IDestBuffer {
  std::set<std::pair<Node,PktId>> destBuff;                   // ∈ Dests ↔ PKT
public:
  IDestBuffer(){ destBuff.clear(); }

  bool dest_recv_pkt(Node nb, PktId pkt){
    if (!Dests.count(nb)) return false;                        // g3: nb ∈ Dests
    if (destBuff.count({nb,pkt})) return false;                // g1
    destBuff.insert({nb,pkt});                                 // a1
    return true;
  }
};
```

### 7.5 ISensingUnit
*Machine state:* `ctlSensedFlg`, `senseBuff`.
```cpp
class ISensingUnit {
  std::map<Node,bool> ctlSensedFlg;             // ∈ ND∖Dests → BOOL
  std::map<Node,std::set<Data>> senseBuff;      // ∈ ND∖Dests → ℙ(ℤ)
public:
  ISensingUnit(){                               // (ND∖Dests)×{FALSE}, (ND∖Dests)×{∅}
    for (Node n : ND) if (!Dests.count(n)) { ctlSensedFlg[n]=false; senseBuff[n]={}; }
  }
  bool sensing(Node x, bool sf, Data data){
    if (!(ND.count(x) && !Dests.count(x))) return false;                   // g1
    if (!ctlSensedFlg.count(x) || ctlSensedFlg.at(x)!=false) return false;  // g4
    ctlSensedFlg[x]=sf;                                                    // a1
    senseBuff[x].insert(data);                                            // a2
    return true;
  }
  bool creatingDataPacket(Node x, const std::set<Node>& des, PktId pkt, Data data){
    if (!(ND.count(x) && !Dests.count(x))) return false;                          // g1
    if (x!=initialSrcAddr.at(pkt) || des!=finalDestAddr.at(pkt)) return false;     // g2
    if (type.at(pkt)!=PktType::DATA) return false;                                // g3
    if (senseBuff.empty() || !senseBuff.count(x) || !senseBuff.at(x).count(data))  // g4
        return false;
    senseBuff[x].erase(data);                                                     // a1
    return true;
  }
};
```

### 7.6 IPacket
*Machine state:* `pktFwdr`, `pktData`, `createdPkts`.
```cpp
class IPacket {
  std::map<PktId,Node> pktFwdr;        // ∈ PKT ⇸ ND
  std::map<PktId,Data> pktData;        // ∈ PKT ⇸ ℤ
  std::set<PktId> createdPkts;         // ⊆ PKT
public:
  IPacket(){ pktFwdr.clear(); pktData.clear(); createdPkts.clear(); }

  bool creatingPkt(Node x, const std::set<Node>& des, PktId pkt, Data data){
    if (!(ND.count(x) && !Dests.count(x))) return false;                          // g1
    if (x!=initialSrcAddr.at(pkt) || des!=finalDestAddr.at(pkt)) return false;     // g2
    if (pktFwdr.count(pkt) || pktData.count(pkt)) return false;                   // g3, g4
    createdPkts.insert(pkt);                                                      // a1
    pktFwdr[pkt]=x;                                                               // a2
    pktData[pkt]=data;                                                            // a3
    return true;
  }
  bool start_tx(Node x, PktId pkt){
    if (!pktFwdr.count(pkt)) return false;                     // g1
    pktFwdr[pkt]=x;                                            // a1 (relational override ⊴, see §6 †)
    return true;
  }
};
```

> **Note.** Each method returns `true` when the event fires and `false` when a guard
> blocks it — the standard reading of an Event-B event as a guarded atomic operation. The
> context functions `type` / `initialSrcAddr` / `finalDestAddr` are read-only constants
> supplied by the context mapping; the machine never mutates them.

---

## Next step — inducing translation rules

This machine-only mapping is the evidence base for the translation-rule catalog. Each
distinct `Event-B → C++` pattern that recurs across the tables above is a rule candidate;
grouping them yields the operator → C++ rules. The recurring patterns visible here:

| Event-B construct (machine) | C++ pattern | Appears in |
|---|---|---|
| `a↦b ∈ R` / `∉ R` (relation) | `R.count({a,b}) > 0` / `== 0` | ISend, IReceive, INDBuffer, IDestBuffer |
| `R := R ∪ {a↦b}` | `R.insert({a,b});` | all buffer interfaces |
| `R := R ∖ {a↦b}` | `R.erase({a,b});` | ISend, IReceive, INDBuffer |
| `x ∈ dom(R)` / `y ∈ ran(R)` (pair-set) | `inDom(R,x)` / `inRan(R,y)` | ISend, INDBuffer |
| `R := R ⩥ {y}` (range subtraction) | erase-pairs-with-`second==y` loop | ISend |
| `f(k)` / `k ∈ dom(f)` (function) | `f.at(k)` / `f.count(k) > 0` | ISensingUnit, IPacket |
| `f(k) := v` / `f ⊴ {k↦v}` | `f[k] = v;` | ISensingUnit, IPacket |
| `f(k) := f(k) ∪ {x}` (set-valued) | `f[k].insert(x);` | ISend (`ctlNeighbours`), ISensingUnit (`senseBuff`) |
| `{k} ◁ R = ∅` (per-key emptiness) | `R.count(k)==0 \|\| R.at(k).empty()` | ISend |
| `S := S ∪ {x}` / `∖ {x}` (plain set) | `S.insert(x);` / `S.erase(x);` | IPacket (`createdPkts`) |
