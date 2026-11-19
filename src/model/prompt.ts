import { stripCodeForModel } from "./stripper.js";

export interface ConstraintPromptParams {
  statement: string;
  constraint: {
    id: string;
    text: string;
  };
  code: string;
}

export function buildModelPrompt(params: ConstraintPromptParams): string {
  const strippedCode = stripCodeForModel(params.code);

  return `You are a strict, objective C++ programming judge for a university computer science lab.
Review the submitted student C++ code against the specified constraint.

### Lab Statement:
${params.statement}

### Constraint to Check:
[${params.constraint.id}] ${params.constraint.text}

### Student Code (comments and identity stripped):
\`\`\`cpp
${strippedCode}
\`\`\`

### Instructions:
1. Determine if the student's implementation complies with the constraint.
2. Return ONLY a single JSON object with this exact schema:
{
  "verdict": "pass" | "violation" | "unsure",
  "evidence": [
    {
      "line": <1-based line number in the submitted code>,
      "text": "<exact line of source code that shows the violation>"
    }
  ]
}
3. Rules:
- If compliant: "verdict": "pass", "evidence": []
- If it violates the constraint: "verdict": "violation", "evidence": [{ "line": ..., "text": ... }]
- If you are not completely certain or the code is ambiguous: "verdict": "unsure", "evidence": []
- DO NOT invent line numbers or change any code characters in "text".
- DO NOT set or suggest any grade, points or deduction. The TA sets that.
- Output ONLY valid JSON, with no markdown code blocks and no conversational prose.`;
}

