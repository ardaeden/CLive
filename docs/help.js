// Renders one help page from registry.js. Every docs/*.html is a thin shell whose
// <body data-section="..."> names the section to show, so the content is always
// generated from the app's own data and cannot go stale.
import {
  LIMITS, LIMIT_DOCS, COMMAND_WORDS, SYNTHS, DRUMS, SCALES, PLAYER_PARAMS, REVERB_PARAMS, BUS_PARAMS,
  SHORTCUTS, COMMANDS, PATTERN_SYNTAX, DRUM_SYNTAX, FUNCTIONS, CONTRACT, GUIDE, csoundSource,
} from "../registry.js";
import { highlight } from "../highlight.js";

let documented = 0;
const undocumented = [];

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid);
  return el;
}

// Text with `code` spans.
function inline(str) {
  const frag = document.createDocumentFragment();
  str.split(/(`[^`]+`)/).forEach((part) => {
    if (part.startsWith("`") && part.endsWith("`")) frag.append(h("code", {}, part.slice(1, -1)));
    else frag.append(part);
  });
  return frag;
}

function docOf(where, doc) {
  if (typeof doc === "string" && doc.trim()) {
    documented++;
    return inline(doc);
  }
  undocumented.push(where);
  return h("span", { class: "undocumented" }, "undocumented");
}

function codeBlock(src) {
  const pre = h("pre");
  pre.innerHTML = highlight(src.replace(/\n$/, "")).replace(/\n$/, "");
  const copy = h("button", { type: "button" }, "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(src);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy failed";
    }
    setTimeout(() => (copy.textContent = "Copy"), 1200);
  });
  return h("div", { class: "code" }, pre, copy);
}

function table(headers, rows) {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((cells) => h("tr", {}, cells.map((c) => h("td", {}, c))))),
    ),
  );
}

const mono = (text) => h("span", { class: "mono" }, text);
const codeCell = (src) => {
  const span = h("span", { class: "mono" });
  span.innerHTML = highlight(src).replace(/\n$/, "");
  return span;
};
// `udo` is the shared opcode a dronable synth's player and drone instruments both call.
// `droneUdo` is for the rare synth (fmbass) whose drone runs genuinely different DSP from
// its player instead of sharing `udo` -- shown separately, labelled, so it isn't hidden.
const sourceDetails = (label, instr, body, udo, droneUdo) => {
  const parts = [udo, droneUdo && droneUdo !== udo ? `; --- drone variant ---\n${droneUdo.trim()}` : null].filter(Boolean).map((s) => s.trim());
  const src = parts.map((s) => s + "\n\n").join("") + csoundSource(label, instr, body);
  return h("details", {}, h("summary", {}, "Csound source"), codeBlock(src));
};

// The extra parameters of a synth: name, default, range and description.
const synthParams = (name, s) =>
  Object.keys(s.params ?? {}).length
    ? table(
        ["Parameter", "Default", "Range", "Description"],
        Object.entries(s.params).map(([key, p]) => [
          mono(key),
          mono(`${p.default}${p.unit ? " " + p.unit : ""}`),
          mono(`${p.min} to ${p.max}`),
          docOf(`SYNTHS.${name}.params.${key}`, p.doc),
        ]),
      )
    : null;

// Generated content per section id, shown after the prose from GUIDE. A GUIDE entry
// without a builder is a prose-only page.
const builders = {
  keys: () => [table(["Keys", "What it does"], SHORTCUTS.map((s) => [mono(s.keys), docOf(`SHORTCUTS.${s.id}`, s.doc)]))],

  players: () => [
    table(
      ["Parameter", "Default", "Description"],
      Object.entries(PLAYER_PARAMS).map(([name, p]) => [mono(name), mono(p.shown ?? String(p.default)), docOf(`PLAYER_PARAMS.${name}`, p.doc)]),
    ),
  ],

  synths: () => [
    table(
      ["Name", "Instrument", "Description"],
      Object.entries(SYNTHS).map(([name, s]) => [
        mono(name),
        mono(String(s.instr)),
        [docOf(`SYNTHS.${name}`, s.doc), synthParams(name, s), sourceDetails(name, s.instr, s.body, s.udo, s.droneUdo)],
      ]),
    ),
  ],

  drums: () => [
    table(
      ["Character", "Sound", "Instrument", "Description"],
      Object.entries(DRUMS).map(([ch, d]) => [mono(`"${ch}"`), d.name, mono(String(d.instr)), [docOf(`DRUMS.${ch}`, d.doc), sourceDetails(d.name, d.instr, d.body)]]),
    ),
    table(["Syntax", "Meaning"], DRUM_SYNTAX.map((x, i) => [codeCell(x.syntax), docOf(`DRUM_SYNTAX[${i}]`, x.doc)])),
  ],

  patterns: () => [
    table(["Syntax", "Meaning"], PATTERN_SYNTAX.map((x, i) => [codeCell(x.syntax), docOf(`PATTERN_SYNTAX[${i}]`, x.doc)])),
    h("h3", {}, "Functions"),
    table(
      ["Function", "Meaning", "Updates"],
      Object.entries(FUNCTIONS).map(([name, f]) => [codeCell(f.syntax), docOf(`FUNCTIONS.${name}`, f.doc), docOf(`FUNCTIONS.${name}.rate`, f.rate)]),
    ),
  ],

  scales: () => [table(["Name", "Semitones from the root"], Object.entries(SCALES).map(([name, notes]) => [mono(`"${name}"`), mono(notes.join(" "))]))],

  reverb: () => [
    table(["Parameter", "Default", "Description"], Object.entries(REVERB_PARAMS).map(([name, p]) => [mono(name), mono(String(p.default)), docOf(`REVERB_PARAMS.${name}`, p.doc)])),
  ],

  buses: () => [
    table(["Parameter", "Default", "Description"], Object.entries(BUS_PARAMS).map(([name, p]) => [mono(name), mono(String(p.default)), docOf(`BUS_PARAMS.${name}`, p.doc)])),
  ],

  csound: () => [table(["Field", "Meaning"], CONTRACT.map((x, i) => [mono(x.field), docOf(`CONTRACT[${i}]`, x.doc)]))],

  commands: () => [
    table(["Statement", "What it does"], COMMANDS.map((x, i) => [codeCell(x.syntax), docOf(`COMMANDS[${i}]`, x.doc)])),
    h("p", {}, "Reserved command words (only special at the very start of a statement): ", COMMAND_WORDS.map((o, i) => [i ? ", " : "", h("code", {}, o)])),
  ],

  limits: () => [table(["Setting", "Value", "Meaning"], Object.entries(LIMITS).map(([k, v]) => [mono(k), mono(String(v)), docOf(`LIMITS.${k}`, LIMIT_DOCS[k])]))],
};

// The section list, its order and its titles all come from GUIDE in registry.js.
const ids = Object.keys(GUIDE);
const pageFor = (id) => (id === "start" ? "index.html" : `${id}.html`);

function buildSection(id) {
  const guide = GUIDE[id];
  return h(
    "section",
    { id },
    h("h2", {}, guide.title),
    guide.paragraphs.map((p) => h("p", {}, inline(p))),
    guide.example ? codeBlock(guide.example) : null,
    builders[id]?.() ?? [],
  );
}

// Every section is built on every page so the documentation check covers all of them.
const built = Object.fromEntries(ids.map((id) => [id, buildSection(id)]));
for (const id of Object.keys(builders)) if (!GUIDE[id]) undocumented.push(`GUIDE.${id}`);

const current = document.body.dataset.section;
const content = document.getElementById("content");
const toc = document.getElementById("toc");

toc.append(
  h("a", { class: "back", href: "../index.html" }, "← Editor"),
  h("h1", {}, "CLive Help"),
  ...ids.map((id) => h("a", { href: pageFor(id), class: id === current ? "current" : "", "data-id": id }, GUIDE[id].title)),
);

const status = h("div", { id: "status" });
content.append(status);

if (!built[current]) {
  content.append(h("p", {}, `Unknown help section '${current}'. Sections: ${ids.join(", ")}.`));
} else {
  document.title = `${GUIDE[current].title} - CLive Help`;
  content.append(built[current]);
  const at = ids.indexOf(current);
  const link = (id, label) => h("a", { href: pageFor(id) }, label);
  content.append(
    h(
      "div",
      { class: "pager" },
      at > 0 ? link(ids[at - 1], `← ${GUIDE[ids[at - 1]].title}`) : h("span"),
      at < ids.length - 1 ? link(ids[at + 1], `${GUIDE[ids[at + 1]].title} →`) : h("span"),
    ),
  );
}

// Adding a section to GUIDE also needs its page file; flag any that is missing.
const problems = [];
if (undocumented.length) problems.push(`${undocumented.length} entries have no documentation: ${undocumented.join(", ")}`);
const missingPages = [];
await Promise.all(
  ids.map(async (id) => {
    let ok = false;
    try {
      ok = (await fetch(pageFor(id), { method: "HEAD" })).ok;
    } catch {
      // Treated as missing below.
    }
    if (!ok) {
      missingPages.push(pageFor(id));
      toc.querySelector(`[data-id="${id}"]`)?.classList.add("broken");
    }
  }),
);
if (missingPages.length) problems.push(`Missing page files in docs/: ${missingPages.join(", ")}`);

status.className = problems.length ? "bad" : "";
status.textContent = problems.length ? problems.join(". ") : `Generated from registry.js: ${documented} documented entries, ${ids.length} pages, none missing.`;
