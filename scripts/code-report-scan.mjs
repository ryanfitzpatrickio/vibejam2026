/**
 * Regenerates metrics for CODE_REPORT.md (same scope/methodology as the doc).
 * Run: node scripts/code-report-scan.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIRS = ["src", "shared", "party", "worker", "scripts"];
const EXT = new Set([".js", ".jsx", ".mjs"]);

function walk(absDir, out = []) {
  if (!fs.existsSync(absDir)) return out;
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    const p = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      walk(p, out);
    } else if (EXT.has(path.extname(ent.name)) && !ent.name.endsWith(".generated.js")) {
      if (ent.name === "code-report-scan.mjs") continue;
      out.push(p);
    }
  }
  return out;
}

/** Strip block/line comments and string/template contents → spaces (preserve newlines). */
function stripCommentsAndStrings(src) {
  let i = 0;
  const n = src.length;
  let out = "";
  const pushSpace = () => {
    out += " ";
  };

  while (i < n) {
    const c = src[i];
    const c1 = src[i + 1];

    if (c === "/" && c1 === "*") {
      i += 2;
      while (i < n - 1 && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i = Math.min(i + 2, n);
      pushSpace();
      continue;
    }
    if (c === "/" && c1 === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        if (src[i] === "\n" && quote === "'") break;
        i++;
      }
      pushSpace();
      continue;
    }

    if (c === "`") {
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            const ch = src[i];
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
            else if (ch === "/" && src[i + 1] === "/") {
              while (i < n && src[i] !== "\n") i++;
              continue;
            } else if (ch === "/" && src[i + 1] === "*") {
              i += 2;
              while (i < n - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
              i = Math.min(i + 2, n);
              continue;
            } else if (ch === '"' || ch === "'" || ch === "`") {
              const q = ch;
              i++;
              while (i < n) {
                if (src[i] === "\\") {
                  i += 2;
                  continue;
                }
                if (src[i] === q) {
                  i++;
                  break;
                }
                i++;
              }
              continue;
            }
            i++;
          }
          continue;
        }
        if (src[i] === "`") {
          i++;
          break;
        }
        i++;
      }
      pushSpace();
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

function countSLOC(cleaned) {
  const lines = cleaned.split(/\r?\n/);
  let sloc = 0;
  for (const line of lines) {
    if (line.trim().length > 0) sloc++;
  }
  return sloc;
}

function cyclomaticApprox(cleaned) {
  let score = 1;
  const s = cleaned;

  const reIf = /\bif\b/g;
  const reFor = /\bfor\b/g;
  const reWhile = /\bwhile\b/g;
  const reCase = /\bcase\b/g;
  const reCatch = /\bcatch\b/g;

  for (const re of [reIf, reFor, reWhile, reCase, reCatch]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) score++;
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "&" && s[i + 1] === "&") {
      score++;
      i++;
      continue;
    }
    if (ch === "|" && s[i + 1] === "|") {
      score++;
      i++;
      continue;
    }
    if (ch === "?" && s[i + 1] !== "." && s[i + 1] !== "?") {
      score++;
      continue;
    }
    if (ch === "?" && s[i + 1] === "?") {
      score++;
      i++;
      continue;
    }
  }

  return score;
}

function countFunctionsApprox(cleaned) {
  let n = 0;
  const reFnWord = /\bfunction\b/g;
  let m;
  while ((m = reFnWord.exec(cleaned)) !== null) n++;

  const reArrow = /=>(?![=>])/g;
  while ((m = reArrow.exec(cleaned)) !== null) n++;

  return n;
}

function analyzeFile(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  const loc = raw.split(/\r?\n/).length;
  const cleaned = stripCommentsAndStrings(raw);
  const sloc = countSLOC(cleaned);
  const cyclomatic = cyclomaticApprox(cleaned);
  const fns = countFunctionsApprox(cleaned);
  const rel = path.relative(ROOT, absPath).split(path.sep).join("/");
  const density = sloc >= 80 ? cyclomatic / sloc : 0;
  return { rel, loc, sloc, cyclomatic, fns, density };
}

function main() {
  const files = [];
  for (const d of DIRS) walk(path.join(ROOT, d), files);
  files.sort();

  const rows = files.map(analyzeFile);
  const totalFiles = rows.length;
  const totalSLOC = rows.reduce((a, r) => a + r.sloc, 0);

  const bySloc = [...rows].sort((a, b) => b.sloc - a.sloc);
  const byCyc = [...rows].sort((a, b) => b.cyclomatic - a.cyclomatic);
  const byDensity = [...rows].filter((r) => r.sloc >= 80).sort((a, b) => b.density - a.density);

  const out = {
    totalFiles,
    totalSLOC,
    topSloc: bySloc.slice(0, 25),
    topCyc: byCyc.slice(0, 25),
    topDensity: byDensity.slice(0, 25),
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
