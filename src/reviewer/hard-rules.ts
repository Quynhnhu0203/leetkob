export interface EvidenceLine {
  line: number;
  text: string;
}

export interface HardRuleResult {
  isBanList: boolean;
  verdict?: "pass" | "violation";
  evidence?: EvidenceLine[];
}

/**
 * Checks if a constraint text represents a ban-list constraint.
 * As per specification: starts with "Do not use" or "Do not call",
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
      // Split if comma or pipe separated inside backticks, or trim
      const val = m[1].trim();
      names.push(val);
    }
  }
  return names;
}

interface Token {
  type: "ident" | "keyword" | "punct" | "macro" | "using_std";
  value: string;
  line: number;
  prefix?: string | undefined; // e.g. "std::", "my::"
}

/**
 * Strips comments from C++ code while preserving original line numbers and character positions.
 */
export function stripComments(sourceCode: string): {
  cleanCode: string;
  sourceLines: string[];
} {
  const lines = sourceCode.split(/\r?\n/);
  const resultLines: string[] = [];
  let inBlockComment = false;

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l] ?? "";
    let cleanLine = "";
    let i = 0;
    while (i < line.length) {
      if (inBlockComment) {
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
        // Line comment: rest of the line is replaced with whitespace
        cleanLine += " ".repeat(line.length - i);
        break;
      } else if (line[i] === '"' || line[i] === "'") {
        // String or char literal: mask its content so identifiers inside are not tokenized as code
        const quote = line[i];
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
        cleanLine += line[i];
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
 * Tokenizes C++ source into syntactic tokens, tracking namespaces and user-defined functions.
 */
export function analyzeCppSource(sourceCode: string): {
  tokens: Token[];
  hasUsingNamespaceStd: boolean;
  userDefinedFunctions: Set<string>;
  macros: Map<string, { body: string; line: number }>;
} {
  const { cleanCode } = stripComments(sourceCode);
  const lines = cleanCode.split("\n");

  const tokens: Token[] = [];
  let hasUsingNamespaceStd = false;
  const userDefinedFunctions = new Set<string>();
  const macros = new Map<string, { body: string; line: number }>();

  // Step 1: Detect using namespace std and macros
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i] ?? "";

    if (/using\s+namespace\s+std\s*;/.test(line)) {
      hasUsingNamespaceStd = true;
    }

    const macroMatch = /^\s*#\s*define\s+([A-Za-z0-9_]+)(?:\([^)]*\))?\s+(.+)$/.exec(line);
    if (macroMatch?.[1] && macroMatch[2]) {
      macros.set(macroMatch[1], { body: macroMatch[2], line: lineNum });
    }
  }

  // Step 2: Detect user-defined functions (e.g. void sort(...) or void my::sort(...))
  // A function definition has a return type, identifier, parameter list, and opening brace
  const funcRegex =
    /(?:void|int|bool|auto|long|double|char)\s+(?:([A-Za-z0-9_]+)::)?([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(cleanCode)) !== null) {
    const ns = match[1];
    const name = match[2];
    if (name) {
      if (ns) {
        userDefinedFunctions.add(`${ns}::${name}`);
      } else {
        userDefinedFunctions.add(name);
      }
    }
  }

  // Step 3: Scan code for tokens
  // Regex to capture qualified or unqualified identifiers, keywords, or operators
  const tokenRegex = /(?:([A-Za-z0-9_]+)::)?([A-Za-z0-9_]+)/g;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i] ?? "";
    if (line.trim().startsWith("#include")) {
      // #include lines are header inclusions, not uses of banned functions
      continue;
    }

    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(line)) !== null) {
      const prefix = m[1];
      const val = m[2];
      if (val) {
        tokens.push({
          type: "ident",
          value: val,
          line: lineNum,
          prefix: prefix ? `${prefix}::` : undefined,
        });
      }
    }
  }

  return {
    tokens,
    hasUsingNamespaceStd,
    userDefinedFunctions,
    macros,
  };
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
  const { tokens, hasUsingNamespaceStd, userDefinedFunctions, macros } =
    analyzeCppSource(sourceCode);

  const evidenceMap = new Map<number, string>();

  // Check each banned name
  for (const banned of bannedNames) {
    // Normalise banned name (e.g. "std::sort", "for", "goto")
    const isLoopKeyword = ["for", "while", "do", "goto"].includes(banned);
    const parts = banned.split("::");
    const unqualifiedBanned = parts[parts.length - 1] ?? banned;
    const isStdNamespace =
      banned.startsWith("std::") || banned.startsWith("std::__") || parts.length === 1;

    // 1. Check macro definitions that expand to banned names
    for (const [macroName, macroInfo] of macros.entries()) {
      if (
        macroInfo.body.includes(banned) ||
        (isStdNamespace && macroInfo.body.includes(unqualifiedBanned))
      ) {
        const line = macroInfo.line;
        evidenceMap.set(line, sourceLines[line - 1] ?? "");

        // Also check where this macro is called
        for (const tok of tokens) {
          if (tok.value === macroName) {
            evidenceMap.set(tok.line, sourceLines[tok.line - 1] ?? "");
          }
        }
      }
    }

    // 2. Check tokens in source code
    for (const tok of tokens) {
      if (isLoopKeyword) {
        if (tok.value === banned && !tok.prefix) {
          evidenceMap.set(tok.line, sourceLines[tok.line - 1] ?? "");
        }
        continue;
      }

      // If token is explicitly qualified (e.g. std::sort)
      if (tok.prefix) {
        const fullName = `${tok.prefix}${tok.value}`;
        if (fullName === banned) {
          evidenceMap.set(tok.line, sourceLines[tok.line - 1] ?? "");
        }
        // If it is my::sort, it does NOT match std::sort
        continue;
      }

      // Unqualified token (e.g. sort, vector, lower_bound)
      if (tok.value === unqualifiedBanned) {
        // If the user defined their own function with this name in the global scope,
        // calling it does not violate the standard library ban!
        if (userDefinedFunctions.has(unqualifiedBanned)) {
          continue;
        }

        // If the constraint banned an unqualified function (e.g. `qsort`, `bsearch`)
        if (parts.length === 1) {
          evidenceMap.set(tok.line, sourceLines[tok.line - 1] ?? "");
          continue;
        }

        // If using namespace std is active, unqualified call resolves to std::
        if (hasUsingNamespaceStd && isStdNamespace) {
          evidenceMap.set(tok.line, sourceLines[tok.line - 1] ?? "");
        }
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
