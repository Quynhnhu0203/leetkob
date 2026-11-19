import type { Constraint, EvidenceLine, ReviewItem, Lab } from "../store.js";
import { checkHardRule } from "./hard-rules.js";
import type { ModelClient, ModelOutput } from "../model/client.js";

export interface SchemaValidationResult {
  valid: boolean;
  output: ModelOutput;
  reason?: string;
}

/**
 * Validates model output against the required schema and verifies
 * that all cited evidence lines match the original submitted code exactly.
 * As per brief §3: If schema validation fails or any evidence line does not match,
 * the verdict becomes "unsure".
 */
export function validateAndVerifyModelOutput(rawOutput: unknown, sourceCode: string): ModelOutput {
  if (typeof rawOutput !== "object" || rawOutput === null || Array.isArray(rawOutput)) {
    return { verdict: "unsure", evidence: [] };
  }

  const candidate = rawOutput as { verdict?: unknown; evidence?: unknown };
  if (
    typeof candidate.verdict !== "string" ||
    !["pass", "violation", "unsure"].includes(candidate.verdict)
  ) {
    return { verdict: "unsure", evidence: [] };
  }

  const verdict = candidate.verdict as "pass" | "violation" | "unsure";

  if (!Array.isArray(candidate.evidence)) {
    return { verdict: "unsure", evidence: [] };
  }

  const sourceLines = sourceCode.split(/\r?\n/);
  const validatedEvidence: EvidenceLine[] = [];

  for (const item of candidate.evidence) {
    if (typeof item !== "object" || item === null) {
      return { verdict: "unsure", evidence: [] };
    }
    const e = item as { line?: unknown; text?: unknown };
    if (typeof e.line !== "number" || !Number.isInteger(e.line) || e.line < 1) {
      return { verdict: "unsure", evidence: [] };
    }
    if (typeof e.text !== "string") {
      return { verdict: "unsure", evidence: [] };
    }

    // Verify evidence line exists and matches source line text exactly (ignoring leading/trailing whitespace)
    if (e.line > sourceLines.length) {
      return { verdict: "unsure", evidence: [] };
    }

    const actualLine = sourceLines[e.line - 1] ?? "";
    if (actualLine.trim() !== e.text.trim()) {
      return { verdict: "unsure", evidence: [] };
    }

    validatedEvidence.push({ line: e.line, text: actualLine });
  }

  // A violation must cite at least one evidence line; if empty, it becomes unsure
  if (verdict === "violation" && validatedEvidence.length === 0) {
    return { verdict: "unsure", evidence: [] };
  }

  return {
    verdict,
    evidence: validatedEvidence,
  };
}

/**
 * Runs constraint review on a submission:
 * 1. Hard rules run first for ban-list constraints (no model call).
 * 2. Model judges semantic constraints with schema validation, timeout, and evidence checking.
 * 3. Returns review items for the TA's review queue.
 */
export async function reviewConstraints(
  code: string,
  lab: Lab,
  constraints: Constraint[],
  modelClient: ModelClient,
  options: { modelOff?: boolean; timeoutMs?: number } = {},
): Promise<Array<Omit<ReviewItem, "reviewed">>> {
  const modelOff = options.modelOff ?? process.env.MODEL_OFF === "1";
  const items: Array<Omit<ReviewItem, "reviewed">> = [];

  for (const c of constraints) {
    // 1. Hard rules run first
    const hardRes = checkHardRule(code, c.text);
    if (hardRes.isBanList && hardRes.verdict) {
      // Hard rule decided this constraint: MODEL IS NOT CALLED!
      items.push({
        labId: lab.id,
        submissionId: 0, // set by caller/worker
        constraintId: c.id,
        verdict: hardRes.verdict,
        evidence: hardRes.evidence ?? [],
        deduction: c.deduction,
        decidedBy: "hard_rule",
      });
      continue;
    }

    // 2. Semantic constraint: judged by model
    if (modelOff) {
      // Model-off flag enabled: emits unsure, opens no network
      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: "unsure",
        evidence: [],
        deduction: c.deduction,
        decidedBy: "model",
      });
      continue;
    }

    // Call model with timeout and schema check
    try {
      const modelOut = await modelClient.call({
        statement: lab.statement ?? "",
        constraint: { id: c.id, text: c.text },
        code,
      });

      const checkedOut = validateAndVerifyModelOutput(modelOut, code);

      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: checkedOut.verdict,
        evidence: checkedOut.evidence,
        deduction: c.deduction,
        decidedBy: "model",
      });
    } catch {
      // Any exception / timeout becomes unsure
      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: "unsure",
        evidence: [],
        deduction: c.deduction,
        decidedBy: "model",
      });
    }
  }

  return items;
}
