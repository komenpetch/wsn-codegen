import { XMLParser } from "fast-xml-parser";
import type { RawModel, RawMachine, RawContext, RawEvent, Labelled } from "./types";
import { splitDeclaration } from "./text";

const EB = "org.eventb.core.";

// fast-xml-parser returns untyped objects keyed by EB element/attribute name.
// A value is either an attribute string, a single child node, or an array of
// child nodes (for the element types forced to arrays below).
type XmlNode = { [key: string]: string | XmlNode | XmlNode[] | undefined };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Force these element types to always be arrays even when singular:
  isArray: (name) =>
    [
      `${EB}variable`, `${EB}invariant`, `${EB}event`, `${EB}guard`,
      `${EB}action`, `${EB}parameter`, `${EB}carrierSet`, `${EB}constant`,
      `${EB}axiom`, `${EB}refinesEvent`, `${EB}seesContext`,
    ].includes(name),
});

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

// Typed readers over the untyped node shape: `attr` pulls an attribute string,
// `childNode` a single child element, `nodes` a (possibly forced) array of them.
const attr = (n: XmlNode, key: string): string => n[key] as string;
const childNode = (n: XmlNode, key: string): XmlNode | undefined =>
  n[key] as XmlNode | undefined;
const nodes = (n: XmlNode, key: string): XmlNode[] =>
  asArray<XmlNode>(n[key] as XmlNode | XmlNode[] | undefined);

const TEXTTOOLS_REPR = "org.eventb.texttools.text_representation";

// The component's name.
//
// PREFERRED: the head of the text_representation attribute, which states the name the
// way Rodin displays it -- `machine pM1 sees C0` yields `pM1`. Only the head is taken;
// the attribute holds the WHOLE machine, so using it unparsed would give a name several
// hundred characters long.
//
// FALL-BACK, and not a nicety: the file name. text_representation is written by an
// optional editor plugin, so a project need not carry it. Measured over the seven
// Event-B projects on disk -- 62 files -- 41 carry the attribute and 21 do not, and the
// 21 include every file of the project the paper's measurements come from. Without the
// fall-back a third of the corpus would have no name at all.
//
// The two never disagreed: of the 41, the head parsed in 41 and matched the file name in
// 41. Rodin keeps the two in step because sibling files address a component by name in
// their refines/sees/extends targets, and those resolved 54 of 54 against file names.
// tests/name-source.test.ts holds that agreement over the whole corpus, so a future
// project where the two disagree fails the suite rather than silently picking one.
function componentName(fileName: string, node: XmlNode): string {
  const repr = node[TEXTTOOLS_REPR];
  if (typeof repr === "string") {
    const head = /^\s*(?:machine|context)\s+([A-Za-z_]\w*)/.exec(repr);
    if (head) return head[1];
  }
  return baseName(fileName);
}

function baseName(fileName: string): string {
  return fileName.replace(/\.(bum|buc)$/i, "");
}

export function parseModel(files: { name: string; xml: string }[]): RawModel {
  const machines: RawMachine[] = [];
  const contexts: RawContext[] = [];

  for (const { name, xml } of files) {
    const root = parser.parse(xml) as XmlNode;
    const machineFile = childNode(root, `${EB}machineFile`);
    const contextFile = childNode(root, `${EB}contextFile`);
    if (machineFile) {
      machines.push(parseMachine(componentName(name, machineFile), machineFile));
    } else if (contextFile) {
      contexts.push(parseContext(componentName(name, contextFile), contextFile));
    }
  }
  return { machines, contexts };
}

function parseMachine(name: string, node: XmlNode): RawMachine {
  const refinesNode = childNode(node, `${EB}refinesMachine`);
  return {
    name,
    refines: refinesNode ? attr(refinesNode, `${EB}target`) : undefined,
    sees: nodes(node, `${EB}seesContext`).map((s) => attr(s, `${EB}target`)),
    variables: nodes(node, `${EB}variable`).map((v) => attr(v, `${EB}identifier`)),
    invariants: nodes(node, `${EB}invariant`).map(labelPred).flatMap(declarations),
    events: nodes(node, `${EB}event`).map(parseEvent),
  };
}

function parseEvent(node: XmlNode): RawEvent {
  const refinesNode = nodes(node, `${EB}refinesEvent`)[0];
  return {
    label: attr(node, `${EB}label`),
    refines: refinesNode ? attr(refinesNode, `${EB}target`) : undefined,
    extended: node[`${EB}extended`] === "true",
    parameters: nodes(node, `${EB}parameter`).map((p) => attr(p, `${EB}identifier`)),
    guards: nodes(node, `${EB}guard`).map(labelPred),
    actions: nodes(node, `${EB}action`).map(labelAssign),
  };
}

function parseContext(name: string, node: XmlNode): RawContext {
  const extNode = childNode(node, `${EB}extendsContext`);
  return {
    name,
    extendsCtx: extNode ? attr(extNode, `${EB}target`) : undefined,
    sets: nodes(node, `${EB}carrierSet`).map((s) => attr(s, `${EB}identifier`)),
    constants: nodes(node, `${EB}constant`).map((c) => attr(c, `${EB}identifier`)),
    axioms: nodes(node, `${EB}axiom`).map(labelPred).flatMap(declarations),
  };
}

const labelPred = (n: XmlNode): Labelled => ({ label: attr(n, `${EB}label`), text: attr(n, `${EB}predicate`) });

// An axiom or invariant written as a conjunction of declarations is those
// declarations, one by one: every reader matches one declaration per predicate,
// so `Sink ∈ ND ∧ Sink = 0` used to be invisible to all of them (see
// splitDeclaration for what is deliberately left whole). A split part is
// labelled after its axiom — `axm2.1`, `axm2.2` — so provenance still names it;
// an unsplit one keeps its label exactly, which keeps every corpus output as is.
const declarations = (l: Labelled): Labelled[] => {
  const parts = splitDeclaration(l.text);
  return parts.length === 1 ? [l] : parts.map((text, i) => ({ label: `${l.label}.${i + 1}`, text }));
};
const labelAssign = (n: XmlNode): Labelled => ({ label: attr(n, `${EB}label`), text: attr(n, `${EB}assignment`) });
