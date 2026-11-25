export interface EvidenceLine {
  line: number;
  text: string;
}

export interface HardRuleResult {
  isBanList: boolean;
  verdict?: "pass" | "violation";
  evidence?: EvidenceLine[];
}

const LOOP_KEYWORDS = new Set(["for", "while", "do", "goto"]);
const MEMBER_ITERATOR_NAMES = new Set(["rbegin", "rend", "crbegin", "crend"]);
const NON_FUNCTION_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "sizeof",
]);

/**
 * Checks if a constraint text represents a ban-list constraint.
 * As per brief §6 / eval/README.md: starts with "Do not use" or "Do not call",
 * and banned names are enclosed in backticks.
 */
export function isBanListConstraint(constraintText: string): boolean {
  const trimmed = constraintText.trim();
  return trimmed.startsWith("Do not use") || trimmed.startsWith("Do not call");
}

/**
 * Extracts all banned identifiers/constructs enclosed in backticks.
 */
export function extractBannedNames(constraintText: string): string[] {
  const matches = constraintText.matchAll(/`([^`]+)`/g);
  const names: string[] = [];
  for (const m of matches) {
    if (m[1]) {
      names.push(m[1].trim());
    }
  }
  return names;
}

interface Token {
  type: "ident";
  value: string;
  line: number;
  prefix?: string | undefined; // e.g. "std::", "std::ranges::", "my::"
  isMemberAccess: boolean; // preceded by '.' or '->'
}

/**
 * Strips C++ comments, string literals, char literals, and C++11 raw string literals
 * while preserving original 1-based line numbers and positions.
 */
export function stripComments(sourceCode: string): {
  cleanCode: string;
  sourceLines: string[];
} {
  const lines = sourceCode.split(/\r?\n/);
  const resultLines: string[] = [];
  let inBlockComment = false;
  let rawStringDelim: string | null = null;

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l] ?? "";
    let cleanLine = "";
    let i = 0;
    while (i < line.length) {
      if (rawStringDelim !== null) {
        const closing = `)${rawStringDelim}"`;
        if (line.startsWith(closing, i)) {
          cleanLine += closing;
          i += closing.length;
          rawStringDelim = null;
        } else {
          cleanLine += " ";
          i++;
        }
      } else if (inBlockComment) {
        if (line[i] === "*" && line[i + 1] === "/") {
          inBlockComment = false;
          cleanLine += "  ";
          i += 2;
        } else {
          cleanLine += " ";
          i++;
        }
      } else if (line[i] === "/" && line[i + 1] === "*") {
        inBlockComment = true;
        cleanLine += "  ";
        i += 2;
      } else if (line[i] === "/" && line[i + 1] === "/") {
        cleanLine += " ".repeat(line.length - i);
        break;
      } else if (line[i] === "R" && line[i + 1] === '"') {
        // C++11 raw string literal: R"delim(...)delim"
        const rawMatch = /^R"([^()\s\\]{0,16})\(/.exec(line.slice(i));
        if (rawMatch && rawMatch[1] !== undefined) {
          rawStringDelim = rawMatch[1];
          cleanLine += rawMatch[0];
          i += rawMatch[0].length;
        } else {
          cleanLine += line[i] ?? "";
          i++;
        }
      } else if (line[i] === '"' || line[i] === "'") {
        const quote = line[i] ?? "";
        cleanLine += quote;
        i++;
        while (i < line.length && line[i] !== quote) {
          if (line[i] === "\\" && i + 1 < line.length) {
            cleanLine += "  ";
            i += 2;
          } else {
            cleanLine += " ";
            i++;
          }
        }
        if (i < line.length) {
          cleanLine += quote;
          i++;
        }
      } else {
        cleanLine += line[i] ?? "";
        i++;
      }
    }
    resultLines.push(cleanLine);
  }

  return {
    cleanCode: resultLines.join("\n"),
    sourceLines: lines,
  };
}

/**
 * Tokenizes a single sanitized C++ line into qualified/unqualified identifiers.
 */
function tokenizeLine(line: string, lineNum: number): Token[] {
  const tokens: Token[] = [];
  const tokenRegex = /(?:(\.|->)\s*)?(?:((?:[A-Za-z_][A-Za-z0-9_]*::)+))?([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(line)) !== null) {
    const dotOrArrow = m[1];
    const prefix = m[2];
    const val = m[3];
    if (val) {
      tokens.push({
        type: "ident",
        value: val,
        line: lineNum,
        prefix: prefix ?? undefined,
        isMemberAccess: Boolean(dotOrArrow),
      });
    }
  }
  return tokens;
}

/**
 * Tokenizes C++ source into syntactic tokens, tracking namespaces, using-declarations,
 * user-defined functions, and macros.
 */
export function analyzeCppSource(sourceCode: string): {
  tokens: Token[];
  hasUsingNamespaceStd: boolean;
  importedStdSymbols: Map<string, string>;
  userDefinedFunctions: Set<string>;
  macros: Map<string, { body: string; line: number; tokens: Token[] }>;
} {
  const { cleanCode } = stripComments(sourceCode);
  const lines = cleanCode.split("\n");

  const tokens: Token[] = [];
  let hasUsingNamespaceStd = false;
  const importedStdSymbols = new Map<string, string>();
  const userDefinedFunctions = new Set<string>();
  const macros = new Map<string, { body: string; line: number; tokens: Token[] }>();

  // Step 1: Detect using namespace std, using std::X declarations, and macros
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i] ?? "";

    if (/using\s+namespace\s+std\s*;/.test(line)) {
      hasUsingNamespaceStd = true;
    }

    const usingDeclMatches = line.matchAll(
      /\busing\s+(std::(?:[A-Za-z_][A-Za-z0-9_]*::)*)([A-Za-z_][A-Za-z0-9_]*)\s*;/g,
    );
    for (const um of usingDeclMatches) {
      if (um[1] && um[2]) {
        importedStdSymbols.set(um[2], `${um[1]}${um[2]}`);
      }
    }

    const macroMatch = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\s+(.+)$/.exec(line);
    if (macroMatch?.[1] && macroMatch[2]) {
      macros.set(macroMatch[1], {
        body: macroMatch[2],
        line: lineNum,
        tokens: tokenizeLine(macroMatch[2], lineNum),
      });
    }
  }

  // Step 2: Detect user-defined functions (any return type, optional qualifiers)
  const funcRegex =
    /(?:^|[;{}])\s*(?:template\s*<[^>{}]*>\s*)?(?:(?:inline|static|constexpr|virtual|friend|explicit)\s+)*([A-Za-z_~][A-Za-z0-9_:<>*&\s,]*?)\s+(?:([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)::)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}()]*\)\s*(?:const|noexcept|override|final)?\s*(?:\{|;)/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(cleanCode)) !== null) {
    const returnType = match[1]?.trim() ?? "";
    const ns = match[2];
    const name = match[3];
    if (
      !name ||
      NON_FUNCTION_KEYWORDS.has(name) ||
      NON_FUNCTION_KEYWORDS.has(returnType.split(/\s+/)[0] ?? "") ||
      returnType.startsWith("#")
    ) {
      continue;
    }
    if (ns) {
      userDefinedFunctions.add(`${ns}::${name}`);
    } else {
      userDefinedFunctions.add(name);
    }
  }

  // Step 3: Scan non-#include, non-#define lines for syntax tokens
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("#include") || /^\s*#\s*define\b/.test(line)) {
      continue;
    }
    tokens.push(...tokenizeLine(line, lineNum));
  }

  return {
    tokens,
    hasUsingNamespaceStd,
    importedStdSymbols,
    userDefinedFunctions,
    macros,
  };
}

function tokenMatchesBanned(
  tok: Token,
  banned: string,
  hasUsingNamespaceStd: boolean,
  importedStdSymbols: Map<string, string>,
  userDefinedFunctions: Set<string>,
): boolean {
  const isLoopKeyword = LOOP_KEYWORDS.has(banned);
  const parts = banned.split("::");
  const unqualifiedBanned = parts[parts.length - 1] ?? banned;
  const isQualifiedBan = parts.length > 1;
  const isStdNamespace = banned.startsWith("std::") || banned.startsWith("std::__");

  if (isLoopKeyword) {
    return !tok.prefix && !tok.isMemberAccess && tok.value === banned;
  }

  // Explicitly qualified call (e.g. std::sort, std::ranges::sort, my::sort)
  if (tok.prefix) {
    const fullName = `${tok.prefix}${tok.value}`;
    return fullName === banned;
  }

  if (tok.value !== unqualifiedBanned) {
    return false;
  }

  // Member method access like box.sort() or s.find():
  // Only flagged when the ban itself is an unqualified member-style facility (e.g. `rbegin`).
  if (tok.isMemberAccess) {
    return !isQualifiedBan && MEMBER_ITERATOR_NAMES.has(banned);
  }

  // Unqualified call via explicit `using std::sort;` overrides/resolves to std::
  if (importedStdSymbols.get(tok.value) === banned) {
    return true;
  }

  // Student-defined global function with the same name does not call the library function
  if (userDefinedFunctions.has(unqualifiedBanned)) {
    return false;
  }

  // Unqualified ban name (e.g. `qsort`, `bsearch`, `__gcd`)
  if (!isQualifiedBan) {
    return true;
  }

  // With `using namespace std;`, unqualified call resolves to std::
  return hasUsingNamespaceStd && isStdNamespace;
}

/**
 * Checks a submission against a ban-list constraint.
 * If the constraint is not a ban list, returns { isBanList: false }.
 */
export function checkHardRule(sourceCode: string, constraintText: string): HardRuleResult {
  if (!isBanListConstraint(constraintText)) {
    return { isBanList: false };
  }

  const bannedNames = extractBannedNames(constraintText);
  if (bannedNames.length === 0) {
    return { isBanList: false };
  }

  const { sourceLines } = stripComments(sourceCode);
  const { tokens, hasUsingNamespaceStd, importedStdSymbols, userDefinedFunctions, macros } =
    analyzeCppSource(sourceCode);

  const evidenceMap = new Map<number, string>();

  for (const banned of bannedNames) {
    // 1. Check macro definitions using tokenized macro body (never raw substring match)
    for (const [macroName, macroInfo] of macros.entries()) {
      const macroUsesBanned = macroInfo.tokens.some((mt) =>
        tokenMatchesBanned(
          mt,
          banned,
          hasUsingNamespaceStd,
          importedStdSymbols,
          userDefinedFunctions,
        ),
      );
      if (macroUsesBanned) {
        evidenceMap.set(macroInfo.line, sourceLines[macroInfo.line - 1] ?? "");

        // Also record call sites of that macro
        for (const tok of tokens) {
          if (tok.value === macroName && !tok.prefix && !tok.isMemberAccess) {
            evidenceMap.set(tok.line, sourceLines[tok.line - 1] ?? "");
          }
        }
      }
    }

    // 2. Check syntax tokens across code
    for (const tok of tokens) {
      if (
        tokenMatchesBanned(
          tok,
          banned,
          hasUsingNamespaceStd,
          importedStdSymbols,
          userDefinedFunctions,
        )
      ) {
        evidenceMap.set(tok.line, sourceLines[tok.line - 1] ?? "");
      }
    }
  }

  if (evidenceMap.size > 0) {
    const evidence: EvidenceLine[] = Array.from(evidenceMap.entries())
      .map(([line, text]) => ({ line, text }))
      .sort((a, b) => a.line - b.line);

    return {
      isBanList: true,
      verdict: "violation",
      evidence,
    };
  }

  return {
    isBanList: true,
    verdict: "pass",
    evidence: [],
  };
}
