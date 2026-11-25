import type { Constraint, EvidenceLine, ReviewItem, Lab, UnsureReason } from "../store.js";
import { checkHardRule } from "./hard-rules.js";
import type { ModelClient, ModelOutput } from "../model/client.js";

export interface SchemaValidationResult {
  valid: boolean;
  output: ModelOutput;
  unsureReason?: UnsureReason | undefined;
}

const DEFAULT_MODEL_TIMEOUT_MS = 15_000;
const defaultLabCallCounts = new Map<number, number>();

/**
 * Validates model output against the required schema and verifies
 * that all cited evidence lines match the original submitted code exactly.
 * Returns both the sanitized ModelOutput and an explicit unsureReason when downgraded
 * (Theo FAQ-09: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-09).
 */
export function validateAndVerifyDetailed(
  rawOutput: unknown,
  sourceCode: string,
): SchemaValidationResult {
  if (typeof rawOutput !== "object" || rawOutput === null || Array.isArray(rawOutput)) {
    return {
      valid: false,
      output: { verdict: "unsure", evidence: [] },
      unsureReason: "invalid_schema",
    };
  }

  const candidate = rawOutput as { verdict?: unknown; evidence?: unknown };
  if (
    typeof candidate.verdict !== "string" ||
    !["pass", "violation", "unsure"].includes(candidate.verdict)
  ) {
    return {
      valid: false,
      output: { verdict: "unsure", evidence: [] },
      unsureReason: "invalid_schema",
    };
  }

  const verdict = candidate.verdict as "pass" | "violation" | "unsure";

  if (!Array.isArray(candidate.evidence)) {
    return {
      valid: false,
      output: { verdict: "unsure", evidence: [] },
      unsureReason: "invalid_schema",
    };
  }

  const sourceLines = sourceCode.split(/\r?\n/);
  const validatedEvidence: EvidenceLine[] = [];

  for (const item of candidate.evidence) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return {
        valid: false,
        output: { verdict: "unsure", evidence: [] },
        unsureReason: "invalid_schema",
      };
    }
    const e = item as { line?: unknown; text?: unknown };
    if (typeof e.line !== "number" || !Number.isInteger(e.line) || e.line < 1) {
      return {
        valid: false,
        output: { verdict: "unsure", evidence: [] },
        unsureReason: "invalid_schema",
      };
    }
    if (typeof e.text !== "string") {
      return {
        valid: false,
        output: { verdict: "unsure", evidence: [] },
        unsureReason: "invalid_schema",
      };
    }

    if (e.line > sourceLines.length) {
      return {
        valid: false,
        output: { verdict: "unsure", evidence: [] },
        unsureReason: "evidence_mismatch",
      };
    }

    const actualLine = sourceLines[e.line - 1] ?? "";
    if (actualLine.trim() !== e.text.trim()) {
      return {
        valid: false,
        output: { verdict: "unsure", evidence: [] },
        unsureReason: "evidence_mismatch",
      };
    }

    validatedEvidence.push({ line: e.line, text: actualLine });
  }

  // A violation must cite at least one verified evidence line; if empty, downgrade to unsure
  if (verdict === "violation" && validatedEvidence.length === 0) {
    return {
      valid: false,
      output: { verdict: "unsure", evidence: [] },
      unsureReason: "evidence_mismatch",
    };
  }

  return {
    valid: true,
    output: {
      verdict,
      evidence: validatedEvidence,
    },
    unsureReason: verdict === "unsure" ? "model_unsure" : undefined,
  };
}

/**
 * Validates model output against the required schema and verifies evidence lines.
 */
export function validateAndVerifyModelOutput(rawOutput: unknown, sourceCode: string): ModelOutput {
  return validateAndVerifyDetailed(rawOutput, sourceCode).output;
}

class ModelTimeoutError extends Error {
  constructor(ms: number) {
    super(`Model call timed out after ${ms}ms`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ModelTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveMaxCallsPerLab(explicit?: number): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const fromEnv = Number(process.env.LLM_MAX_CALLS_PER_LAB);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return Number.POSITIVE_INFINITY;
}

/**
 * Runs constraint review on an Accepted submission:
 * 1. Hard rules run first for ban-list constraints (model is never called).
 * 2. Model judges semantic constraints under timeout, per-lab cost cap, and schema/evidence verification.
 * 3. Returns review items landing solely in the TA's review queue.
 */
export async function reviewConstraints(
  code: string,
  lab: Lab,
  constraints: Constraint[],
  modelClient: ModelClient,
  options: {
    modelOff?: boolean;
    timeoutMs?: number;
    maxCallsPerLab?: number;
    labCallCounts?: Map<number, number>;
  } = {},
): Promise<Array<Omit<ReviewItem, "reviewed">>> {
  const modelOff = options.modelOff ?? process.env.MODEL_OFF === "1";
  const timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  const maxCallsPerLab = resolveMaxCallsPerLab(options.maxCallsPerLab);
  const callCounts = options.labCallCounts ?? defaultLabCallCounts;
  const items: Array<Omit<ReviewItem, "reviewed">> = [];

  for (const c of constraints) {
    // 1. Hard rules run first
    const hardRes = checkHardRule(code, c.text);
    if (hardRes.isBanList && hardRes.verdict) {
      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: hardRes.verdict,
        evidence: hardRes.evidence ?? [],
        deduction: c.deduction,
        decidedBy: "hard_rule",
      });
      continue;
    }

    // 2. Semantic constraint
    if (modelOff) {
      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: "unsure",
        evidence: [],
        deduction: c.deduction,
        decidedBy: "model",
        unsureReason: "model_off",
      });
      continue;
    }

    const usedCalls = callCounts.get(lab.id) ?? 0;
    if (usedCalls >= maxCallsPerLab) {
      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: "unsure",
        evidence: [],
        deduction: c.deduction,
        decidedBy: "model",
        unsureReason: "cost_cap",
      });
      continue;
    }

    callCounts.set(lab.id, usedCalls + 1);

    try {
      const modelOut = await withTimeout(
        modelClient.call({
          statement: lab.statement ?? "",
          constraint: { id: c.id, text: c.text },
          code,
        }),
        timeoutMs,
      );

      const detailed = validateAndVerifyDetailed(modelOut, code);
      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: detailed.output.verdict,
        evidence: detailed.output.evidence,
        deduction: c.deduction,
        decidedBy: "model",
        unsureReason: detailed.unsureReason,
      });
    } catch (err) {
      const isTimeout =
        err instanceof ModelTimeoutError ||
        (err instanceof Error && /timed? ?out|abort/i.test(err.message));
      items.push({
        labId: lab.id,
        submissionId: 0,
        constraintId: c.id,
        verdict: "unsure",
        evidence: [],
        deduction: c.deduction,
        decidedBy: "model",
        unsureReason: isTimeout ? "timeout" : "error",
      });
    }
  }

  return items;
}
