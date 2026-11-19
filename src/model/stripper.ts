/**
 * Strips comments and student identity information from C++ source code.
 * Preserves 1-based line numbers by replacing comment lines with blanks
 * and line comments with whitespace.
 */
export function stripCodeForModel(sourceCode: string): string {
  const lines = sourceCode.split(/\r?\n/);
  const result: string[] = [];
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
        // Strip comment to the end of the line
        break;
      } else if (line[i] === '"' || line[i] === "'") {
        // String literal: preserve it, but check for student id patterns
        const quote = line[i];
        cleanLine += quote;
        i++;
        while (i < line.length && line[i] !== quote) {
          if (line[i] === "\\" && i + 1 < line.length) {
            cleanLine += line[i] + line[i + 1];
            i += 2;
          } else {
            cleanLine += line[i];
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

    // Strip student ID patterns (e.g. 23120xxx or similar 8-digit student ids)
    cleanLine = cleanLine.replace(/\b2\d{7}\b/g, "[STUDENT_ID]");

    result.push(cleanLine);
  }

  return result.join("\n");
}
