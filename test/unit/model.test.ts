import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripCodeForModel } from "../../src/model/stripper.js";
import { buildModelPrompt } from "../../src/model/prompt.js";
import { GeminiModelClient, OfflineFakeModelClient } from "../../src/model/client.js";
import { costUsd, priceFor } from "../../src/model/pricing.js";
import { runChecker } from "../../src/checker-cli.js";

describe("Model Stripper — Identity and Comment Sanitization", () => {
  it("strips comments while preserving line count", () => {
    const raw = `
// Author: Nguyen Van A - 23120068
#include <iostream>
/* Block comment explaining
   the merge sort implementation */
int main() {
    // print hello
    return 0;
}
`;
    const stripped = stripCodeForModel(raw);
    expect(stripped).not.toContain("Author");
    expect(stripped).not.toContain("Nguyen Van A");
    expect(stripped).not.toContain("23120068");
    expect(stripped).not.toContain("Block comment");
    expect(stripped).not.toContain("print hello");
    expect(stripped).toContain("int main()");

    // Verify line count is preserved exactly
    expect(stripped.split("\n").length).toBe(raw.split("\n").length);
  });
});

describe("Model Prompt Generation", () => {
  it("sends only statement, constraints, and stripped code — no student identity", () => {
    const prompt = buildModelPrompt({
      statement: "Implement merge sort on an array of integers.",
      constraint: {
        id: "C2",
        text: "Sort with a merge sort you wrote yourself: split the range, sort both halves, merge them.",
      },
      code: `// Student 23120099
void mergeSort() {}
int main() {}`,
    });

    expect(prompt).toContain("Implement merge sort on an array of integers.");
    expect(prompt).toContain("Sort with a merge sort you wrote yourself");
    expect(prompt).toContain("void mergeSort()");
    expect(prompt).not.toContain("23120099");
    expect(prompt).not.toContain("Student 23120099");

    // Must never leak dev-set filenames or specific problem tuning
    expect(prompt).not.toContain("sort-merge/s05");
    expect(prompt).not.toContain("labels.jsonl");

    // Checks schema instructions
    expect(prompt).toContain('"verdict": "pass" | "violation" | "unsure"');
    expect(prompt).toContain('"evidence"');
  });
});

describe("Model prices (Gemini Developer API, paid tier, Standard, USD per 1M tokens)", () => {
  const nov2026 = new Date("2026-11-28T00:00:00Z");
  const jan2027 = new Date("2027-01-02T00:00:00Z");

  it.each([
    ["gemini-3.8-flash", nov2026, 0.75, 3.75],
    ["gemini-3.8-flash", jan2027, 1.5, 7.5],
    ["gemini-3.6-flash", nov2026, 0.75, 3.75],
    ["gemini-3.6-flash", jan2027, 1.5, 7.5],
    ["gemini-3-flash-preview", nov2026, 0.5, 3.0],
    ["gemini-3.5-flash-lite", nov2026, 0.3, 2.5],
  ])("%s on %s: input %d, output %d", (model, at, input, output) => {
    expect(priceFor(model, at)).toEqual({ known: true, inputPerM: input, outputPerM: output });
  });

  it("prices an unknown model at the dearest known rate, so a cost is never understated", () => {
    const p = priceFor("gemini-9-ultra", nov2026);
    expect(p.known).toBe(false);
    expect(p.inputPerM).toBeGreaterThanOrEqual(1.5);
    expect(p.outputPerM).toBeGreaterThanOrEqual(7.5);
  });

  it("charges thinking tokens at the output rate", () => {
    // 1000 in × 0.75 + (40 out + 200 thinking) × 3.75, per 1M
    expect(costUsd("gemini-3.8-flash", 1000, 240, nov2026)).toBeCloseTo(0.00165, 10);
  });

  it("logs thinking tokens and prices the call by the model that answered", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          responseId: "provider-req-cost",
          modelVersion: "gemini-3.8-flash",
          candidates: [{ content: { parts: [{ text: '{"verdict":"pass","evidence":[]}' }] } }],
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 200,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new GeminiModelClient({
        apiKey: "fake-key-test",
        model: "gemini-3.8-flash",
        fallbackModel: "",
        now: () => nov2026,
      });
      await client.call({
        statement: "Sort",
        constraint: { id: "C2", text: "Merge sort" },
        code: "int main(){}",
      });
      const entry = client.getCallLog()[0];
      expect(entry?.thoughtsTokens).toBe(200);
      expect(entry?.totalTokens).toBe(1240);
      expect(entry?.costUsd).toBeCloseTo(0.00165, 10);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Model Call Log and Cost Arithmetic", () => {
  it("logs model calls with provider request id, tokens, and cost", async () => {
    const fakeClient = new OfflineFakeModelClient({
      "C2:void mergeSort() {}": {
        verdict: "pass",
        evidence: [],
      },
    });

    const res = await fakeClient.call({
      statement: "Sort array",
      constraint: { id: "C2", text: "Sort with own merge sort" },
      code: "void mergeSort() {}",
    });

    expect(res.verdict).toBe("pass");
    const log = fakeClient.getCallLog();
    expect(log.length).toBe(1);
    expect(log[0]?.requestId).toMatch(/^fake-req-/);
    expect(log[0]?.model).toBe("offline-fake-model");
    expect(log[0]?.promptTokens).toBeGreaterThan(0);
    expect(log[0]?.totalTokens).toBeGreaterThan(0);
    expect(log[0]?.parsedOutput?.verdict).toBe("pass");
  });

  it("falls back to fallbackModel when primary model returns HTTP 503 (without real network)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            responseId: "provider-req-xyz",
            modelVersion: "gemini-3.6-flash",
            candidates: [{ content: { parts: [{ text: '{"verdict":"pass","evidence":[]}' }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new GeminiModelClient({
        apiKey: "fake-key-test",
        model: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
      });
      const out = await client.call({
        statement: "Sort",
        constraint: { id: "C2", text: "Merge sort" },
        code: "int main(){}",
      });
      expect(out).toEqual({ verdict: "pass", evidence: [] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const entry = client.getCallLog()[0];
      expect(entry?.requestId).toBe("provider-req-xyz");
      expect(entry?.model).toBe("gemini-3.6-flash");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back through multi-model chain when primary times out and second hits 429", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(new Response("quota exceeded", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            responseId: "provider-req-fallback-after-timeout",
            modelVersion: "gemini-3-flash-preview",
            candidates: [{ content: { parts: [{ text: '{"verdict":"pass","evidence":[]}' }] } }],
            usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 15 },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new GeminiModelClient({
        apiKey: "fake-key-test",
        model: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash,gemini-3-flash-preview",
        timeoutMs: 800,
      });
      const out = await client.call({
        statement: "Sort",
        constraint: { id: "C2", text: "Merge sort" },
        code: "int main(){}",
      });
      expect(out).toEqual({ verdict: "pass", evidence: [] });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const entry = client.getCallLog()[0];
      expect(entry?.requestId).toBe("provider-req-fallback-after-timeout");
      expect(entry?.model).toBe("gemini-3-flash-preview");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Checker CLI — MODEL_OFF=1 & standalone dataset execution", () => {
  it("writes valid JSONL using hard rules only and 0 model calls when MODEL_OFF=1", async () => {
    const tmpOut = path.join(os.tmpdir(), `leetkob-pred-${Date.now()}.jsonl`);
    const fakeClient = new OfflineFakeModelClient();
    const callSpy = vi.spyOn(fakeClient, "call");

    const prevOff = process.env.MODEL_OFF;
    process.env.MODEL_OFF = "1";
    try {
      const preds = await runChecker({
        dataDir: path.resolve(__dirname, "../../eval"),
        outputFile: tmpOut,
        modelClient: fakeClient,
      });

      // Zero model calls when MODEL_OFF=1
      expect(callSpy).not.toHaveBeenCalled();
      expect(preds.length).toBe(102);

      // Ban-list C1 in sort-merge/s04 catches violation cleanly
      const s04c1 = preds.find((p) => p.solution === "sort-merge/s04" && p.constraint === "C1");
      expect(s04c1?.verdict).toBe("violation");
      expect(s04c1?.evidence.length).toBeGreaterThan(0);

      // Semantic C2 in sort-merge/s01 outputs unsure
      const s01c2 = preds.find((p) => p.solution === "sort-merge/s01" && p.constraint === "C2");
      expect(s01c2?.verdict).toBe("unsure");

      const written = await fs.readFile(tmpOut, "utf8");
      expect(written.trim().split("\n").length).toBe(102);
    } finally {
      if (prevOff === undefined) delete process.env.MODEL_OFF;
      else process.env.MODEL_OFF = prevOff;
      await fs.rm(tmpOut, { force: true });
    }
  });
});
