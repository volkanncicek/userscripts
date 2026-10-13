// Enforces the conventions in AGENTS.md that ESLint cannot see: the values that make a script self-updating and keep
// its Tampermonkey identity stable, grants that match what the code uses, the README table, the per-site opt-in for
// scripts that match every site, English-only comments, and one prefixed log helper.
import { readFileSync, readdirSync } from "node:fs";
import * as espree from "espree";

const { namespace, url } = JSON.parse(readFileSync("package.json", "utf8")).userscripts;
const LEADING_KEYS = ["name", "namespace", "version", "updateURL", "downloadURL", "description", "author"];
const FORBIDDEN_KEYS = ["license", "copyright"];
const VERSION = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;
const AUTHOR = "volkan.cicek";
const ALL_SITES = ["*://*/*", "*"];
// Tampermonkey hands GM_info to every script whatever its grants say, so it is neither required nor unused.
const UNGATED_GRANTS = ["GM_info"];
const PARSE_OPTIONS = { ecmaVersion: "latest", sourceType: "script", comment: true, tokens: true, loc: true };

const walk = (node, visit, parent = null) => {
  visit(node, parent);
  for (const key of espree.VisitorKeys[node.type] ?? []) {
    for (const child of [node[key]].flat()) if (child?.type) walk(child, visit, node);
  }
};

const usedGrants = (tokens) => {
  const used = new Map();
  const note = (name, token) => used.has(name) || used.set(name, token.loc.start.line);
  tokens.forEach((token, i) => {
    if (token.type !== "Identifier") return;
    const [dot, member] = [tokens[i + 1], tokens[i + 2]];
    const memberName = dot?.value === "." && tokens[i - 1]?.value !== "." ? member?.value : undefined;
    if (/^GM_\w+$/.test(token.value) || token.value === "unsafeWindow") note(token.value, token);
    else if (token.value === "GM" && memberName) note(`GM.${memberName}`, token);
    else if (token.value === "window" && memberName === "onurlchange") note("window.onurlchange", token);
  });
  return used;
};

const isConsole = (node) =>
  node.type === "MemberExpression" && node.object.type === "Identifier" && node.object.name === "console";

const checkLogging = (ast, name, report) => {
  const prefix = `[${name}]`;
  const literals = new Map();
  let logDeclarator;
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier") return;
    if (node.id.name === "log" && !logDeclarator) logDeclarator = node;
    if (node.init?.type === "Literal" && typeof node.init.value === "string")
      literals.set(node.id.name, node.init.value);
  });

  const inside = (node) => logDeclarator && node.start >= logDeclarator.start && node.end <= logDeclarator.end;
  walk(ast, (node, parent) => {
    if (!isConsole(node)) return;
    const line = node.loc.start.line;
    if (!inside(node)) {
      report(line, `console.${node.property.name ?? "?"} outside the log helper; route it through log`);
      return;
    }
    const first = parent?.type === "CallExpression" && parent.callee === node ? parent.arguments[0] : undefined;
    const value =
      first?.type === "Literal" ? first.value : first?.type === "Identifier" ? literals.get(first.name) : undefined;
    if (value !== prefix) report(line, `log prefix must be the literal "${prefix}"`);
  });
};

const checkComments = (ast, headerEnd, report) => {
  for (const comment of ast.comments) {
    if (comment.loc.start.line > headerEnd && TURKISH.test(comment.value)) {
      report(comment.loc.start.line, "comments must be English");
    }
  }
  walk(ast, (node) => {
    if (node.type !== "TemplateElement") return;
    for (const match of node.value.raw.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (!TURKISH.test(match[0])) continue;
      const offset = node.value.raw.slice(0, match.index).split("\n").length - 1;
      report(node.loc.start.line + offset, "comments must be English");
    }
  });
};

const problems = [];
const files = readdirSync(".").filter((name) => name.endsWith(".user.js"));
for (const file of files) {
  const report = (line, message) => problems.push(line ? `${file}:${line}: ${message}` : `${file}: ${message}`);
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const end = lines.indexOf("// ==/UserScript==");
  if (lines[0] !== "// ==UserScript==" || end < 0) {
    report(1, "metadata block must open on line 1 and close with // ==/UserScript==");
    continue;
  }

  const entries = [];
  for (let i = 1; i < end; i++) {
    const match = /^\/\/ @(\S+)(\s+)(.*)$/.exec(lines[i]);
    if (!match) {
      report(i + 1, "not a metadata line");
      continue;
    }
    const [, key, gap, value] = match;
    // Values start in one column so the block reads as a table, matching what Tampermonkey's editor produces.
    const aligned = key.length <= 12 ? `@${key}${gap}`.length === 14 : gap === " ";
    if (!aligned) report(i + 1, `@${key}: value must start at column 18`);
    entries.push({ key, value, line: i + 1 });
  }

  const value = (key) => entries.find((entry) => entry.key === key)?.value;
  const values = (key) => entries.filter((entry) => entry.key === key).map((entry) => entry.value);
  LEADING_KEYS.forEach((key, index) => {
    if (entries[index]?.key !== key) report(entries[index]?.line ?? end, `key #${index + 1} must be @${key}`);
  });
  for (const entry of entries) {
    if (FORBIDDEN_KEYS.includes(entry.key)) report(entry.line, `@${entry.key} is not used in this repo`);
  }

  const expectedUrl = url.replace("{file}", file);
  if (value("namespace") !== namespace) report(2, `@namespace must be ${namespace}`);
  if (!VERSION.test(value("version") ?? "")) report(3, "@version must be the date of the change, YYYY.MM.DD[.n]");
  if (value("updateURL") !== expectedUrl) report(4, `@updateURL must be ${expectedUrl}`);
  if (value("downloadURL") !== expectedUrl) report(5, `@downloadURL must be ${expectedUrl}`);
  if (value("author") !== AUTHOR) report(7, `@author must be ${AUTHOR}`);
  if (TURKISH.test(value("name") ?? "") || TURKISH.test(value("description") ?? "")) {
    report(1, "@name and @description must be English");
  }

  let ast;
  try {
    ast = espree.parse(source, PARSE_OPTIONS);
  } catch (error) {
    report(error.lineNumber, `cannot parse: ${error.message}`);
    continue;
  }

  const grants = values("grant");
  const used = usedGrants(ast.tokens);
  if (grants.includes("none")) {
    for (const [name, line] of used) if (!UNGATED_GRANTS.includes(name)) report(line, `@grant none but uses ${name}`);
  } else {
    for (const [name, line] of used) {
      if (!grants.includes(name) && !UNGATED_GRANTS.includes(name)) report(line, `uses ${name} without @grant`);
    }
    for (const entry of entries.filter((entry) => entry.key === "grant")) {
      if (!used.has(entry.value) && !UNGATED_GRANTS.includes(entry.value)) {
        report(entry.line, `@grant ${entry.value} is never used`);
      }
    }
  }

  if ([...values("match"), ...values("include")].some((pattern) => ALL_SITES.includes(pattern))) {
    const required = ["GM_registerMenuCommand", "GM_getValue", "GM_setValue"];
    if (!entries.some((entry) => entry.key === "noframes")) report(end, "a script matching every site needs @noframes");
    for (const grant of required.filter((grant) => !grants.includes(grant))) {
      report(end, `a script matching every site needs @grant ${grant} for its per-host opt-in`);
    }
    const hostsKey = ast.tokens.some((token) => token.type === "String" && token.value.slice(1, -1) === "enabledHosts");
    if (!hostsKey) report(end, 'a script matching every site keeps its opt-in hosts under "enabledHosts"');
  }

  checkComments(ast, end + 1, report);
  checkLogging(ast, value("name"), report);
}

const readmeStems = new Set();
for (const line of readFileSync("README.md", "utf8").split(/\r?\n/)) {
  const match = /^\|.*\(https:\/\/raw\.githubusercontent\.com\/[^)]*\/([^/)]+)\.user\.js\)/.exec(line);
  if (match) readmeStems.add(match[1]);
}
const fileStems = new Set(files.map((file) => file.slice(0, -".user.js".length)));
for (const stem of fileStems) if (!readmeStems.has(stem)) problems.push(`README.md: no table row for ${stem}.user.js`);
for (const stem of readmeStems) if (!fileStems.has(stem)) problems.push(`README.md: row for missing ${stem}.user.js`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("scripts ok");
