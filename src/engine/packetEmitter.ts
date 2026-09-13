import type { PacketModel } from "./packetModel";
import { getterOf, setterOf } from "./packetModel";


// Chunk length in bytes. Every field is emitted as a 4-byte quantity, so the
// declared length matches what a real serializer would write. INET checks the
// declared length against the data, so a wrong constant surfaces as a runtime
// assertion, not a silent truncation.
const BYTES_PER_FIELD = 4;

export function emitPacketClasses(pm: PacketModel): { header: string; impl: string } {
  const tags = [...pm.lattice.tagOf.entries()].sort((a, b) => a[1] - b[1]);
  const len = (pm.fields.length + 1) * BYTES_PER_FIELD;   // +1 for the type tag

  const accessors = pm.fields.map((f) => {
    const T = f.cppType;
    return `    ${T} ${getterOf(f)}() const { return ${f.name}; }\n` +
           `    void ${setterOf(f)}(${T} v) { handleChange(); ${f.name} = v; }`;
  }).join("\n");

  const members = pm.fields.map((f) =>
    `    ${f.cppType} ${f.name} = ${f.cppType === "Node" ? "-1" : "0"};   // Event-B: ${f.ebName}`
  ).join("\n");

  const header =
`// PPkt derives from inet::FieldsChunk (Chunk.h's base for a chunk that
// carries data as C++ fields rather than a raw byte buffer), which none of
// wsn-codegen's own fixed include list does not pull it in: the chain from
// Packet.h reaches BitsChunk/BytesChunk/EmptyChunk/SequenceChunk, but not
// FieldsChunk (task-7 finding -- without this, "class PPkt : public
// inet::FieldsChunk" fails to parse, an incomplete-type error, and every
// declaration inside PPkt cascades from it).
#include "inet/common/packet/chunk/FieldsChunk.h"

// ---- PPkt: the packet pattern class -------------------------------------
// The Event-B model keeps packet attributes as functions keyed by packet id
// (${pm.fields.map((f) => f.ebName).join(", ")}). Here they are fields on one
// chunk, because in a simulator the attributes travel with the packet.
enum class PktType {
${tags.map(([t, v]) => `    ${t} = ${v},`).join("\n")}
};

class PPkt : public inet::FieldsChunk
{
  protected:
    PktType type = PktType::${tags[0][0]};
${members}

  public:
    PPkt() { this->chunkLength = inet::B(${len}); }
    PPkt(const PPkt& other) = default;
    virtual PPkt *dup() const override { return new PPkt(*this); }

    PktType getType() const { return type; }
    void setType(PktType v) { handleChange(); type = v; }
${accessors}
};

${pm.leaves.map((l) =>
`// Event-B: ${l.event}
class ${l.typeName} : public PPkt
{
  public:
    ${l.typeName}();
    virtual ${l.typeName} *dup() const override { return new ${l.typeName}(*this); }
};`).join("\n\n")}
`;

  const impl = pm.leaves.map((l) =>
`${l.typeName}::${l.typeName}()
{
    type = PktType::${l.tag};
}`).join("\n\n") + "\n";

  return { header, impl };
}
