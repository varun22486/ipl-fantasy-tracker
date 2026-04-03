/**
 * Sanity checks for joint run-out parsing (e.g. Prabhsimran run out by Sarfaraz Khan and Ruturaj Gaikwad).
 * Run: npx --yes tsx scripts/verify-runout-example.ts
 */
import {
  parseRunOutFieldersFromDismissalText,
  splitRunOutFieldersFromText,
} from "../lib/runout-fielders";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`verify-runout: ${msg}`);
}

const slash = splitRunOutFieldersFromText("Sarfaraz Khan/Ruturaj Gaikwad");
assert(slash.length === 2, `slash pair: expected 2, got ${slash.join(" | ")}`);
assert(slash[0].includes("Sarfaraz"), "first fielder Sarfaraz");
assert(slash[1].includes("Ruturaj"), "second fielder Ruturaj");

const andJoined = splitRunOutFieldersFromText("Sarfaraz Khan and Ruturaj Gaikwad");
assert(andJoined.length === 2, `and pair: expected 2, got ${andJoined.join(" | ")}`);

const paren = parseRunOutFieldersFromDismissalText(
  "run out (Sarfaraz Khan/Ruturaj Gaikwad)"
);
assert(paren.length === 2, `paren slash: ${paren.join(" | ")}`);

const parenAnd = parseRunOutFieldersFromDismissalText(
  "run out (Sarfaraz Khan and Ruturaj Gaikwad)"
);
assert(parenAnd.length === 2, `paren and: ${parenAnd.join(" | ")}`);

const noParen = parseRunOutFieldersFromDismissalText(
  "run out Sarfaraz Khan/Ruturaj Gaikwad b Arshdeep Singh"
);
assert(noParen.length === 2, `no-paren slash before b: ${noParen.join(" | ")}`);

console.log("verify-runout-example: OK");
