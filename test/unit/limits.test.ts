import { describe, it, expect } from "vitest";
import { validateAndVerifyModelOutput, reviewConstraints } from "../../src/reviewer/limits.js";
import { OfflineFakeModelClient } from "../../src/model/client.js";
import { InMemoryStore, type Lab, type Constraint } from "../../src/store.js";
import { buildApp } from "../../src/app.js";

describe("First Limits — Schema Validation and Timeout Guardrails", () => {
  const sampleCode = `
#include <iostream>
void mySort(int* a, int n) {
    for (int i = 0; i < n; i++) {}
}
int main() { return 0; }
`.trim();

  it("Limit 1 (Schema): passes valid schema with matching evidence lines", () => {
    const raw = {
      verdict: "violation",
      evidence: [
        {
          line: 3,
          text: "    for (int i = 0; i < n; i++) {}",
        },
      ],
    };
    const out = validateAndVerifyModelOutput(raw, sampleCode);
    expect(out.verdict).toBe("violation");
    expect(out.evidence.length).toBe(1);
    expect(out.evidence[0]?.line).toBe(3);
  });

  it("Limit 1 (Schema): invalid schema shape becomes unsure (including bad evidence field on pass)", () => {
    expect(validateAndVerifyModelOutput("free text from model", sampleCode)).toEqual({
      verdict: "unsure",
      evidence: [],
    });
    expect(validateAndVerifyModelOutput(null, sampleCode)).toEqual({
      verdict: "unsure",
      evidence: [],
    });
    expect(validateAndVerifyModelOutput({ verdict: "unknown_verdict" }, sampleCode)).toEqual({
      verdict: "unsure",
      evidence: [],
    });
    expect(
      validateAndVerifyModelOutput({ verdict: "pass", evidence: "not-an-array" }, sampleCode),
    ).toEqual({
      verdict: "unsure",
      evidence: [],
    });
  });

  it("Limit 1 (Schema): non-matching evidence line becomes unsure", () => {
    const raw = {
      verdict: "violation",
      evidence: [
        {
          line: 2,
          text: "std::sort(a, a + n);", // does not match line 2 ("void mySort(int* a, int n) {")
        },
      ],
    };
    const out = validateAndVerifyModelOutput(raw, sampleCode);
    expect(out.verdict).toBe("unsure");
    expect(out.evidence).toEqual([]);
  });

  it("Limit 1 (Schema): out-of-range line number becomes unsure", () => {
    const raw = {
      verdict: "violation",
      evidence: [
        {
          line: 999,
          text: "some non-existent line",
        },
      ],
    };
    const out = validateAndVerifyModelOutput(raw, sampleCode);
    expect(out.verdict).toBe("unsure");
  });

  it("Limit 2 (Timeout): an instant timeout failure becomes unsure", async () => {
    const fakeClient = new OfflineFakeModelClient();
    fakeClient.failWithTimeout = true;

    const lab: Lab = {
      id: 1,
      classId: 10,
      statement: "Sort an array",
      closesAt: new Date(),
    };
    const constraints: Constraint[] = [
      {
        id: "C2",
        text: "Sort with a merge sort you wrote yourself",
        deduction: 4,
      },
    ];

    const results = await reviewConstraints("void mergeSort() {}", lab, constraints, fakeClient);
    expect(results.length).toBe(1);
    expect(results[0]?.verdict).toBe("unsure");
    expect(results[0]?.evidence).toEqual([]);
    expect(results[0]?.decidedBy).toBe("model");
  });

  it("Limit 2 (Real Async Timeout): enforces options.timeoutMs when fake model hangs", async () => {
    const fakeClient = new OfflineFakeModelClient({}, { verdict: "pass", evidence: [] });
    fakeClient.delayMs = 200; // slower than timeoutMs

    const lab: Lab = {
      id: 1,
      classId: 10,
      statement: "Sort an array",
      closesAt: new Date(),
    };
    const constraints: Constraint[] = [
      {
        id: "C2",
        text: "Sort with a merge sort you wrote yourself",
        deduction: 4,
      },
    ];

    const start = Date.now();
    const results = await reviewConstraints("void mergeSort() {}", lab, constraints, fakeClient, {
      timeoutMs: 25,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(150);
    expect(results.length).toBe(1);
    expect(results[0]?.verdict).toBe("unsure");
    expect(results[0]?.unsureReason).toBe("timeout");
  });

  it("Cost cap (LLM_MAX_CALLS_PER_LAB): stops calling model after per-lab limit and marks unsure", async () => {
    const fakeClient = new OfflineFakeModelClient({}, { verdict: "pass", evidence: [] });

    const lab: Lab = {
      id: 42,
      classId: 10,
      statement: "Sort an array",
      closesAt: new Date(),
    };
    const constraints: Constraint[] = [
      { id: "C2", text: "Semantic rule A", deduction: 3 },
      { id: "C3", text: "Semantic rule B", deduction: 3 },
    ];

    const callCounts = new Map<number, number>();
    const results = await reviewConstraints("int main(){}", lab, constraints, fakeClient, {
      maxCallsPerLab: 1,
      labCallCounts: callCounts,
    });

    expect(fakeClient.getCallLog().length).toBe(1);
    expect(results[0]?.verdict).toBe("pass");
    expect(results[1]?.verdict).toBe("unsure");
    expect(results[1]?.unsureReason).toBe("cost_cap");
  });

  it("Hard rules first: model is NOT called when hard rule decides ban-list constraint", async () => {
    const fakeClient = new OfflineFakeModelClient();

    const lab: Lab = {
      id: 1,
      classId: 10,
      statement: "Sort an array",
      closesAt: new Date(),
    };
    const constraints: Constraint[] = [
      {
        id: "C1",
        text: "Do not call a library sort function: `std::sort`, `qsort`.",
        deduction: 3,
      },
    ];

    const codeWithStdSort = `
#include <algorithm>
#include <vector>
int main() {
    std::vector<int> a;
    std::sort(a.begin(), a.end());
    return 0;
}
`;

    const results = await reviewConstraints(codeWithStdSort, lab, constraints, fakeClient);
    expect(results.length).toBe(1);
    expect(results[0]?.verdict).toBe("violation");
    expect(results[0]?.decidedBy).toBe("hard_rule");

    // Proves model was NOT called
    expect(fakeClient.getCallLog().length).toBe(0);
  });

  it("Review Queue (FAQ-09): TA cannot confirm unsure as final verdict and violation needs evidence", async () => {
    const store = new InMemoryStore({
      users: [{ id: 10, role: "ta", token: "tok-ta" }],
      classes: [{ id: 1, taIds: [10] }],
      labs: [{ id: 1, classId: 1, closesAt: new Date(Date.now() + 10000) }],
      reviewItems: [
        {
          labId: 1,
          submissionId: 50,
          constraintId: "C2",
          verdict: "unsure",
          evidence: [],
          deduction: 4,
          decidedBy: "model",
          reviewed: false,
        },
      ],
    });
    const app = buildApp({ store });

    // Confirming as "unsure" must be refused (400 validation)
    const unsureAttempt = await app.inject({
      method: "PUT",
      url: "/v1/labs/1/reviews/50/C2",
      headers: { authorization: "Bearer tok-ta", "content-type": "application/json" },
      payload: JSON.stringify({ verdict: "unsure" }),
    });
    expect(unsureAttempt.statusCode).toBe(400);

    // Changing to "violation" with no existing/supplied evidence must be refused (FAQ-09)
    const missingEvidenceAttempt = await app.inject({
      method: "PUT",
      url: "/v1/labs/1/reviews/50/C2",
      headers: { authorization: "Bearer tok-ta", "content-type": "application/json" },
      payload: JSON.stringify({ verdict: "violation" }),
    });
    expect(missingEvidenceAttempt.statusCode).toBe(400);

    // Valid override to "violation" WITH evidence line succeeds
    const validViolation = await app.inject({
      method: "PUT",
      url: "/v1/labs/1/reviews/50/C2",
      headers: { authorization: "Bearer tok-ta", "content-type": "application/json" },
      payload: JSON.stringify({
        verdict: "violation",
        evidence: [{ line: 4, text: "sort(a, a+n);" }],
      }),
    });
    expect(validViolation.statusCode).toBe(200);
  });
});
