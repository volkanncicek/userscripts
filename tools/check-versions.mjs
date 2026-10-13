// Guards what Tampermonkey's updater relies on between two versions of a script: a higher @version, a stable identity
// and stable storage keys. Usage: node tools/check-versions.mjs [--base <ref>] [--staged]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as espree from "espree";

const { values: args } = parseArgs({
  options: { base: { type: "string", default: "HEAD" }, staged: { type: "boolean", default: false } },
});
const VERSION = /^(\d{4})\.(\d{2})\.(\d{2})(\.\d+)?$/;
const STORAGE_CALLS = ["GM_setValue", "GM_getValue", "GM_deleteValue"];
const LOCAL_STORAGE_METHODS = ["getItem", "setItem", "removeItem"];
const KEY_NAME = /(_KEY|_PREFIX)$/;

const git = (...gitArgs) => execFileSync("git", gitArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const baseExists = (() => {
  if (/^0+$/.test(args.base)) return false;
  try {
    git("rev-parse", "--verify", "--quiet", `${args.base}^{commit}`);
    return true;
  } catch {
    return false;
  }
})();
if (!baseExists) {
  console.log(`versions: base ${args.base} does not exist, nothing to compare`);
  process.exit(0);
}

const header = (source) => {
  const lines = source.split(/\r?\n/);
  const end = lines.indexOf("// ==/UserScript==");
  const entries = {};
  for (const line of lines.slice(1, end)) {
    const match = /^\/\/ @(\S+)\s+(.*)$/.exec(line);
    if (match) entries[match[1]] ??= match[2];
  }
  return entries;
};

const walk = (node, visit) => {
  visit(node);
  for (const key of espree.VisitorKeys[node.type] ?? []) {
    for (const child of [node[key]].flat()) if (child?.type) walk(child, visit);
  }
};

const stringValue = (node) => (node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined);

const storageKeys = (source) => {
  const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script" });
  const keys = new Set();
  const add = (value) => value !== undefined && keys.add(value);

  // Scripts wrap everything in one IIFE, so its body is the top level that holds the configuration constants.
  const topLevel = [...ast.body];
  for (const statement of ast.body) {
    const callee = statement.type === "ExpressionStatement" ? statement.expression.callee : undefined;
    if (callee?.body?.type === "BlockStatement") topLevel.push(...callee.body.body);
  }
  for (const statement of topLevel) {
    if (statement.type !== "VariableDeclaration" || statement.kind !== "const") continue;
    for (const declarator of statement.declarations) {
      if (KEY_NAME.test(declarator.id.name ?? "")) add(stringValue(declarator.init));
    }
  }

  walk(ast, (node) => {
    if (node.type === "PropertyDefinition" && node.static && KEY_NAME.test(node.key.name ?? "")) {
      add(stringValue(node.value));
    }
    if (node.type !== "CallExpression") return;
    const { callee } = node;
    const isStorageCall =
      (callee.type === "Identifier" && STORAGE_CALLS.includes(callee.name)) ||
      (callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        callee.object.name === "localStorage" &&
        LOCAL_STORAGE_METHODS.includes(callee.property.name));
    if (isStorageCall) add(stringValue(node.arguments[0]));
  });
  return keys;
};

const compareVersions = (a, b) => {
  const [left, right] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? -1) - (right[i] ?? -1);
    if (diff) return Math.sign(diff);
  }
  return 0;
};

const datePart = (version) => version.split(".").slice(0, 3).join(".");

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10).replaceAll("-", ".");

const diffArgs = ["diff", "-M", "--name-status", ...(args.staged ? ["--cached"] : []), args.base, "--"];
const changes = git(...diffArgs)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));

const problems = [];
for (const [status, path, renamedTo] of changes) {
  const report = (message) => problems.push(`${renamedTo ?? path}: ${message}`);
  const paths = [path, renamedTo].filter(Boolean);
  if (!paths.some((p) => p.endsWith(".user.js"))) continue;
  if (status.startsWith("R")) {
    report(`renamed from ${path}; a new file name is a new Tampermonkey identity`);
    continue;
  }
  if (status === "A" || status === "D") continue;

  const before = git("show", `${args.base}:${path}`);
  const after = args.staged ? git("show", `:${path}`) : readFileSync(path, "utf8");
  const [old, now] = [header(before), header(after)];

  for (const key of ["name", "namespace"]) {
    if (old[key] !== now[key])
      report(`@${key} changed from "${old[key]}" to "${now[key]}"; that installs a new script`);
  }

  if (!VERSION.test(now.version ?? "")) {
    report(`@version "${now.version}" is not YYYY.MM.DD[.n]`);
  } else if (VERSION.test(old.version ?? "")) {
    if (compareVersions(now.version, old.version) <= 0) {
      report(`@version ${now.version} must be greater than ${old.version}, or Tampermonkey skips the update`);
    }
    if (datePart(now.version) > tomorrow) report(`@version ${now.version} is dated in the future`);
    if (datePart(now.version) < datePart(old.version)) {
      report(`@version ${now.version} is dated before the previous ${old.version}`);
    }
  }

  // Data saved under a key that is no longer read is orphaned without any error, so a key may never disappear.
  let removed;
  try {
    const current = storageKeys(after);
    removed = [...storageKeys(before)].filter((key) => !current.has(key));
  } catch (error) {
    report(`cannot parse: ${error.message}`);
    continue;
  }
  for (const key of removed) report(`storage key "${key}" disappeared`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`versions ok against ${args.base}${args.staged ? " (staged)" : ""}`);
