import { describe, it, expect } from "vitest";
import { validateAndVerifyModelOutput, reviewConstraints } from "../../src/reviewer/limits.js";
import { OfflineFakeModelClient } from "../../src/model/client.js";
import type { Lab, Constraint } from "../../src/store.js";

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

  it("Limit 1 (Schema): invalid schema shape becomes unsure", () => {
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

  it("Limit 2 (Timeout): a call that times out becomes unsure", async () => {
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
});

