// Turns a failed patch's reason into a short, specific fix instruction. Written for models that
// get exact syntax wrong: say what is wrong, what the closest valid thing is, and the form to use.

import { printNode, structure } from "../scene/parse.ts";
import { ACTION_VERBS, type RoleId } from "../scene/registry.ts";
import type { Show } from "../scene/ast.ts";
import type { Workspace } from "./guard.ts";
import { ownsPhrase, roleTitle, roleVocabulary } from "./patchguide.ts";

export interface FeedbackCtx { ws: Workspace; show: Show; role: RoleId; targets: string[] }

// ---------------------------------------------------------------- nearest word

/** edit distance counting a swap of two neighbours as one edit */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** the closest options to a word (best first); nothing when none is plausibly a typo */
export function nearest(word: string, options: string[], max = 3): string[] {
  const w = word.toLowerCase();
  const limit = Math.max(2, Math.floor(w.length / 2));
  return [...new Set(options)]
    .map((o) => {
      const l = o.toLowerCase();
      const sub = w.length >= 3 && (l.startsWith(w) || w.startsWith(l) || l.includes(w)) ? 0.5 : Infinity;
      return { o, d: Math.min(distance(w, l), sub) };
    })
    .filter((x) => x.d <= limit)
    .sort((x, y) => x.d - y.d || x.o.localeCompare(y.o))
    .slice(0, max)
    .map((x) => x.o);
}

// ---------------------------------------------------------------- helpers

const ADDR = /^(\d+[A-Z]*)(?:\.(\d+))?$/;
const list = (xs: string[], n = 14) => (xs.length > n ? [...xs.slice(0, n), "..."] : xs).join(" ");
const sentence = (...p: (string | null | false | undefined)[]) => p.filter(Boolean).join(" ");

function bodyOf(c: FeedbackCtx, shot: string) { return structure(c.ws.doc).shots.find((s) => s.id === shot); }

function lineAt(c: FeedbackCtx, addr: string): string | null {
  const st = structure(c.ws.doc);
  const i = st.addr.get(addr);
  if (i === undefined) return null;
  const n = c.ws.doc.lines[i].node;
  return n ? printNode(n).trim() : null;
}

function addrOfText(c: FeedbackCtx, text: string): string | null {
  const st = structure(c.ws.doc);
  for (const [addr, i] of st.addr) { const n = c.ws.doc.lines[i].node; if (n && printNode(n).trim() === text.trim()) return addr; }
  return null;
}

function firstOp(patch: string): { addr: string; raw: string } | null {
  for (const raw of patch.split("\n")) { const t = raw.trim(); if (t && !t.startsWith("#")) { const m = t.match(/^(\S+)/); if (m) return { addr: m[1], raw: t }; } }
  return null;
}

/** a real, valid-looking example address from the targets for syntax hints */
function sampleAddr(c: FeedbackCtx): string {
  const b = bodyOf(c, c.targets[0] ?? "");
  return b?.body[0]?.addr ?? c.targets[0] ?? "1A.1";
}

function pool(c: FeedbackCtx, kind: string): string[] {
  const v = roleVocabulary(c);
  const chars = Object.keys(c.show.cast);
  const sets = [...new Set(structure(c.ws.doc).shots.filter((s) => c.targets.includes(s.id)).map((s) => s.scene.set))].map((s) => c.show.sets[s]).filter(Boolean);
  const anchors = [...new Set(sets.flatMap((s) => Object.keys(s.anchors)))];
  const props = [...new Set(sets.flatMap((s) => Object.keys(s.props)))];
  void v;
  switch (kind) {
    case "anchor": return anchors;
    case "char": return chars;
    case "prop": return props;
    case "place": return [...anchors, ...chars];
    default: return [...anchors, ...chars, ...props];
  }
}

const KIND_WORD: Record<string, string> = { place: "anchor or character", anchor: "anchor", char: "character", prop: "prop", any: "anchor, character or prop", none: "nothing" };
const closest = (w: string, opts: string[]) => { const n = nearest(w, opts); return n.length ? ` Closest: ${n.join(", ")}.` : ""; };

// ---------------------------------------------------------------- main

export function explainFailure(patchText: string, reason: string, c: FeedbackCtx): string {
  const first = reason.split(/\n| \|\| /).map((x) => x.trim()).filter(Boolean)[0] ?? reason.trim();
  const out = explain(patchText, first, reason, c);
  return out ?? `Fix this: ${first}`;
}

function explain(patch: string, r: string, all: string, c: FeedbackCtx): string | null {
  const msg = r.replace(/^(patch|permission|grammar|locality|qc):\s*/, "");
  const kind = (r.match(/^(patch|permission|grammar|locality|qc):/) ?? [])[1];
  const mine = c.targets.join(", ");

  if (/^empty patch/.test(r)) return `The patch is empty. Write at least one line such as "${sampleAddr(c)} ~1 -> ~2" using an address from the listing.`;

  // ---- permission
  if (kind === "permission") {
    const who = roleTitle(c.role);
    const owned = (o: string) => (o === "any" ? "another role's" : `${/^[aeiou]/i.test(roleTitle(o as RoleId)) ? "an" : "a"} ${roleTitle(o as RoleId)}`);
    let m: RegExpMatchArray | null;
    if ((m = msg.match(/cannot change (\S+) \(owned by (\w+)\)/))) {
      const t = lineAt(c, m[1]);
      return `As ${who} you cannot change ${t ? `"${t}" ` : `${m[1]} `}(${owned(m[2])} line). Change only ${ownsPhrase(c.role)} lines.`;
    }
    if ((m = msg.match(/cannot write an? (\w+) line \(owned by (\w+)\)/))) return `As ${who} you cannot write a ${m[1]} line (${owned(m[2])} line). Write only ${ownsPhrase(c.role)} lines.`;
    if ((m = msg.match(/cannot turn (\S+) into an? (\w+) line/))) return `As ${who} you cannot turn ${m[1]} into a ${m[2]} line (${owned(m[2])} line). Keep the verb inside your own set: ${list(roleVocabulary(c).verbs)}.`;
    if (/cannot drop shot/.test(msg)) return `As ${who} you cannot drop a shot; only the Editor can. Change lines inside ${mine} instead.`;
    if (/cannot add shots/.test(msg)) return `As ${who} you cannot add shots; only the DP can. Change lines inside ${mine} instead.`;
  }

  // ---- locality
  if (kind === "locality") {
    const m = msg.match(/^(\S+) would change too \((.*)\)$/s);
    if (m) {
      const [, shot, why] = m;
      const addressed = patch.split("\n").some((l) => l.trim().split(/\s/)[0]?.split(".")[0] === shot);
      if (!c.targets.includes(shot) && (addressed || /the patch edits lines in this shot/.test(why))) return `${shot} is not one of your shots. Only change ${mine}.`;
      let pin: RegExpMatchArray | null;
      if ((pin = why.match(/(\w+) starts ([\d.]+)m from where they did/))) {
        const set = [...new Set(structure(c.ws.doc).shots.filter((s) => s.id === shot).map((s) => s.scene.set))][0];
        const anchors = set && c.show.sets[set] ? Object.keys(c.show.sets[set].anchors) : [];
        return `Your change moves where ${pin[1]} ends up, so ${shot} starts ${pin[2]}m off. Keep ${pin[1]} finishing where they did, or pin them with ${pin[1]}@<anchor> (anchors: ${list(anchors, 8)}) on a line in your own shot.`;
      }
      if (/different expression/.test(why)) return `Your change alters the face ${shot} starts with. End your shot on the same expression it had before, or keep the last expression line unchanged.`;
      if (/is now on set|no longer on set/.test(why)) return `Your change puts a character on or off set at the start of ${shot}. Keep who is on set the same as before.`;
      if (/length changes/.test(why)) return `Your change alters the length of ${shot} (${why.match(/length changes (.*)/)?.[1]}). Keep total timing in ${mine} the same, or shorten rather than add.`;
      if (/camera setup moves/.test(why)) return `Your change moves the camera in ${shot}. Do not change what the camera frames at the start of your shot.`;
      return `Your change also alters ${shot} (${why}). Change only ${mine}; use a smaller edit that keeps where people end up the same.`;
    }
  }

  // ---- qc
  if (kind === "qc") {
    const m = msg.match(/^(\S*)\s*(.*)$/s)!;
    const what = m[2];
    let tail = "Undo the part that causes it or pick another position.";
    if (/intersect/.test(what)) tail = "Move one of them to a different anchor, or change the timing so they do not overlap.";
    else if (/inside the|inside a wall/.test(what)) tail = "Pick an anchor that is not furniture.";
    else if (/isn't on set|before entering|who isn't in the scene/.test(what)) tail = "Make sure the character has entered (actor@anchor or an enter line) and exists in the cast.";
    else if (/leaves frame/.test(what)) tail = "Use a wider size or a pan/track move.";
    return `That patch creates a new problem${m[1] ? ` in ${m[1]}` : ""}: ${what.replace(/^line \d+: /, "")}. ${tail}`;
  }

  // ---- no-op
  if (/^no visible change/.test(r)) {
    const op = firstOp(patch);
    const t = op && lineAt(c, op.addr);
    return `That patch changes nothing. ${t ? `The line already reads "${t}". ` : ""}Make a different change.`.replace(/\s+$/, "");
  }

  const m1 = (re: RegExp) => msg.match(re);
  let m: RegExpMatchArray | null;

  // ---- vocabulary
  if ((m = m1(/unknown verb "([^"]*)"/))) {
    const v = roleVocabulary(c).verbs;
    return `"${m[1]}" is not a verb you can use.${closest(m[1], v)} Your verbs: ${v.join(" ")}.`;
  }
  if ((m = m1(/unknown character "([^"]*)"/))) { const ch = Object.keys(c.show.cast); return `"${m[1]}" is not a character.${closest(m[1], ch)} Characters: ${ch.join(" ")}.`; }
  if ((m = m1(/unknown anchor "([^"]*)" in set (\S+)/))) { const a = pool(c, "anchor"); return `"${m[1]}" is not an anchor in ${m[2]}.${closest(m[1], a)} Anchors: ${list(a)}.`; }
  if ((m = m1(/"([^"]*)" is not a valid (anchor or character|character|anchor|prop) for (\w+)/))) {
    const k = m[2] === "anchor or character" ? "place" : m[2] === "character" ? "char" : m[2];
    const o = pool(c, k);
    return `"${m[1]}" is not an ${m[2] === "prop" ? "available prop" : m[2]} for ${m[3]}.${closest(m[1], o)} Use one of: ${list(o)}.`;
  }
  if ((m = m1(/unknown (sfx|music|ambience) "([^"]*)"/))) { const o = roleVocabulary({ ...c, role: "sound" }).other[m[1]]; return `"${m[2]}" is not a ${m[1]} name.${closest(m[2], o)} ${m[1]} names: ${list(o, 30)}.`; }
  if ((m = m1(/light must be one of: (.*)$/))) return `That is not a light mood. Use one of: ${m[1]}.`;
  if ((m = m1(/(angle|side|move speed) must be one of: (.*)$/))) return `Bad ${m[1]}. Use one of: ${m[2]}.`;
  if ((m = m1(/unknown shot type "([^"]*)" \(use (.*)\)/))) return `"${m[1]}" is not a shot type.${closest(m[1], m[2].split(" "))} Use one of: ${m[2]}.`;
  if ((m = m1(/shot (\S+) needs a type/))) return `Shot ${m[1]} needs a type after its id, e.g. "${m[1]} MCU kiran".`;
  if ((m = m1(/unexpected "([^"]*)" in shot header/))) {
    const v = roleVocabulary({ ...c, role: "dp" });
    const o = [...v.other.moves, ...v.other.sizes, ...Object.keys(c.show.cast)];
    return `"${m[1]}" does not belong in a shot header.${closest(m[1], o)} Header form: <id> <type> [subject] [move[.speed]] [lens mm] [angle a] [side s].`;
  }
  if ((m = m1(/(lens|trim head|trim tail|hold|episode|scene|act) needs a number/))) return `${m[1]} needs a number after it, e.g. "${m[1] === "lens" ? "lens 50" : m[1] === "hold" ? "hold 1" : m[1] === "trim head" ? "trim 0.4 0.8" : m[1] + " 1"}".`;
  if (/lens must be between/.test(msg)) return "The lens must be between 8 and 600 mm, e.g. lens 50.";
  if ((m = m1(/(OTS|POV|TWO) needs two subjects/))) return `${m[1]} needs two subjects written a>b with no spaces, e.g. "kiran>mum".`;
  if ((m = m1(/(\w+) takes one subject/))) return `${m[1]} takes one subject, or none to frame the whole room.`;
  if (/INSERT/.test(msg)) return "INSERT needs exactly one prop or anchor from the set as its subject.";

  // ---- action line shape
  if ((m = m1(/(\w+) needs a target/))) { const d = ACTION_VERBS[m[1]]; const k = d?.target ?? "any"; return `${m[1]} needs a target (${KIND_WORD[k]}). Options: ${list(pool(c, k))}.`; }
  if ((m = m1(/(\w+) takes no target/))) return `${m[1]} takes no target. Write just "actor ${m[1]}" with an optional ~N.`;
  if ((m = m1(/(\w+) takes one target/))) return `${m[1]} takes only one target.`;
  if (/give needs/.test(msg)) return 'give needs a prop then a character: "kiran give cake mum".';
  if ((m = m1(/(\w+) takes no number/))) return `${m[1]} takes no number. Only walk and run take a speed; write durations as ~N.`;
  if (/cannot target themselves/.test(msg)) return "A character cannot target themselves. Pick another character, anchor or prop.";
  if ((m = m1(/"(~[^"]*)" is not a valid name/))) return `"${m[1]}" is not a duration. Write ~N with a positive number, e.g. ~2.5.`;
  if (/duration must be positive|speed must be positive|values must be positive/.test(msg)) return "Durations and speeds must be positive numbers, e.g. ~1.5.";
  if (/only one number allowed/.test(msg)) return "Only one number is allowed on an action line (the speed for walk/run). Write lengths as ~N.";
  if ((m = m1(/"([^"]*)" is not a valid name/))) return `"${m[1]}" is not a valid name. Use a character, anchor or prop id from the listing.`;
  if ((m = m1(/"([^"]*)" is not a character name/))) return `"${m[1]}" is not a character name. Start the line with a character: ${Object.keys(c.show.cast).join(" ")}.`;
  if (/needs a verb/.test(msg)) return `The line needs a verb after the character. Your verbs: ${list(roleVocabulary(c).verbs)}.`;
  if (/(say|whisper|shout) needs a "quoted line"/.test(msg)) return 'Dialogue needs a straight double-quoted line: mum say "Get two forks." to kiran.';
  if (/after dialogue|words after dialogue/.test(msg)) return 'Dialogue ends after the quote, an optional "to <character>", and an optional ~N: mum say "Hi." to kiran ~2.';
  if (/empty dialogue/.test(msg)) return "The dialogue text is empty. Put words inside the double quotes.";
  if (/`with` needs a line/.test(msg)) return "`with` must be followed by a full line, e.g. with sfx sting.";
  if (/first beat of a shot cannot start with/.test(msg)) return "The first beat of a shot cannot start with `with`. Remove `with` from that line.";
  if (/only one light line/.test(msg)) return "A shot can hold only one light line. Replace the existing light line instead of adding another.";
  if (/silence takes only/.test(msg)) return "silence takes only a length: silence ~1.";
  if ((m = m1(/(sfx|music|ambience) needs a name/))) return `${m[1]} needs a name: ${m[1]} <name>.`;
  if (/unexpected "[^"]*" after (sfx|music|ambience)/.test(msg)) return "Sound lines are `sfx <name> [~N]`: one name, then an optional length.";
  if (/must be "episode", "scene"|a line at column 0/.test(msg)) return `Body lines are not allowed at column 0 in a patch address form. Write "ADDR + <line>" to add a line to a shot.`;
  if ((m = m1(/unexpected "([^"]*)"/))) return `"${m[1]}" is extra. Check the line against the syntax in the guide; only one target per verb, no extra words.`;

  // ---- patch structure
  if ((m = m1(/no line at address (\S+)/))) {
    const a = ADDR.exec(m[1]);
    if (a) {
      const shot = a[1];
      if (!c.targets.includes(shot)) return bodyOf(c, shot) ? `${shot} is not one of your shots. Only change ${mine}.` : `Shot ${shot} does not exist. Only change ${mine}.`;
      const b = bodyOf(c, shot);
      if (b) return `${m[1]} does not exist. ${shot} has lines ${shot}.1 to ${shot}.${b.body.length} (see the listing).`;
    }
    return `${m[1]} is not an address. Use shot ids like 1D and line addresses like 1D.2 from the listing.`;
  }
  if ((m = m1(/"([^"]*)" not found in: (.*)$/s))) {
    const a = addrOfText(c, m[2]);
    return `${a ? `${a} reads` : "That line reads"} "${m[2].trim()}", which has no "${m[1]}". Copy the old tokens exactly from the listing, or use ${a ?? "ADDR"} = <whole new line>.`;
  }
  if ((m = m1(/"([^"]*)" is ambiguous in: (.*)$/s))) return `"${m[1]}" appears more than once in "${m[2].trim()}". Use ADDR = <whole new line> instead.`;
  if ((m = m1(/(\S+) became empty/))) return `${m[1]} would become empty. Use "${m[1]} -" to delete a line.`;
  if (/shot ids cannot be renamed/.test(msg)) return "You cannot rename a shot. Keep its id the same on the header line.";
  if (/header can only be replaced by a header/.test(msg)) return "A header can only be replaced by a header, and a body line only by a body line.";
  if (/use \+\+ to insert shots/.test(msg)) return "Shots are added with ++ (DP only): 1D ++ 1DA CU mum. A + insert holds one body line.";
  if ((m = m1(/(\S+) is not inside a shot/))) return `${m[1]} is not a line inside a shot. Insert after a shot id or a line address like 1D.2.`;
  if ((m = m1(/(\S+) is not a shot header/))) return `${m[1]} is not a shot id. "++" goes after a shot id like 1D.`;
  if ((m = m1(/shot id (\S+) already exists/))) return `Shot id ${m[1]} is already used. Pick a new id, e.g. ${m[1]}A.`;
  if ((m = m1(/(\S+) was already deleted/))) return `${m[1]} was already deleted earlier in the patch. Each address can be changed once.`;
  if (/scene and episode lines cannot be deleted/.test(msg)) return "Scene and episode lines cannot be changed. Edit only lines inside your shots.";
  if (/"\+\+" needs a shot header/.test(msg)) return "++ needs a shot header: 1D ++ 1DA CU mum.";
  if ((m = m1(/empty (insert|replace) at (\S+)/))) return `${m[2]} ${m[1] === "insert" ? "+" : "="} needs a line after it.`;

  // ---- syntax
  if ((m = m1(/can't read patch line: (.*)$/s))) {
    const ln = m[1].trim();
    const a = sampleAddr(c);
    if (/^```|^\*\*|^-{3}|^[A-Za-z ]+:$/.test(ln)) return "Write only patch lines: no markdown, fences or commentary. One op per line.";
    if (/->/.test(ln)) return `Edit form: "${a} ~2 -> ~3" (address, the old tokens, ->, the new tokens). Both sides need at least one token.`;
    if (/^\S+\s+=/.test(ln)) return `Replace form: "${a} = <whole new line>". The new line must follow the = sign.`;
    if (/^\S+\s+\+\+/.test(ln)) return `New shot form (DP only): "${c.targets[0] ?? "1D"} ++ 1DA CU mum".`;
    if (/^\S+\s+\+/.test(ln)) return `Insert form: "${a} + <new line>", one line after the +.`;
    if (/^\S+\s*-/.test(ln)) return `Delete form: "${a} -" with nothing after the dash.`;
    return `Each patch line starts with an address and one operator: "${a} ~2 -> ~3", "${a} = <line>", "${a} + <line>" or "${a} -". Write one op per line, no commentary.`;
  }
  void all;
  return null;
}
