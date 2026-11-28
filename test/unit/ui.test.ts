import { Script, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CLIENT_HELPERS } from "../../src/ui/client-helpers.js";
import { renderAppHtml } from "../../src/ui/html.js";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

interface Helpers {
  escapeHtml(value: unknown): string;
  testVerdictBadge(verdict: unknown): { cls: string; label: string };
  pickLabId(labs: unknown, preferredId?: unknown): number | null;
  parseConstraintsJson(
    text: string,
  ): Parsed<Array<{ id: string; text: string; deduction: number }>>;
  pairTestFiles(
    files: Array<{ name: string; text: string }>,
  ): Parsed<Array<{ name: string; input: string; expectedOutput: string }>>;
}

// Evaluate the exact source the browser runs, not a TypeScript copy of it.
const helpers = runInNewContext(
  `${CLIENT_HELPERS}; ({ escapeHtml, testVerdictBadge, pickLabId, parseConstraintsJson, pairTestFiles })`,
) as Helpers;

// A JSON value built inside the vm context fails toEqual's prototype check; copy it out.
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("UI client helpers", () => {
  it("escapes HTML so student code in evidence cannot run as markup", () => {
    const evil = `// <img src=x onerror="alert('x')"> & more`;
    const out = helpers.escapeHtml(evil);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain('"');
    expect(out).not.toContain("'");
    expect(out).toBe("// &lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; more");
    expect(helpers.escapeHtml(undefined)).toBe("");
  });

  it("shows the real test verdict, never a default AC", () => {
    expect(helpers.testVerdictBadge("AC")).toEqual({ cls: "badge-ac", label: "AC" });
    expect(helpers.testVerdictBadge("WA")).toEqual({ cls: "badge-wa", label: "WA" });
    expect(helpers.testVerdictBadge("TLE")).toEqual({ cls: "badge-wa", label: "TLE" });
    expect(helpers.testVerdictBadge(undefined).label).not.toBe("AC");
  });

  it("picks a lab only from the user's own list, or none", () => {
    const labs = [{ id: 1 }, { id: 4 }];
    expect(helpers.pickLabId(labs, 1)).toBe(1);
    expect(helpers.pickLabId(labs, "1")).toBe(1);
    expect(helpers.pickLabId(labs)).toBe(4);
    expect(helpers.pickLabId(labs, 9)).toBe(4);
    // A TA of another class lists no labs: no lab id is kept from the previous user.
    expect(helpers.pickLabId([], 1)).toBeNull();
    expect(helpers.pickLabId(undefined, 1)).toBeNull();
  });

  describe("parseConstraintsJson (constraints.json as published in the brief)", () => {
    it("accepts an array of {id, text, deduction} as is", () => {
      const text = JSON.stringify([
        { id: "C1", text: "Do not call `qsort`.", deduction: 3 },
        { id: "C2", text: "Write merge sort yourself.", deduction: 4 },
      ]);
      expect(plain(helpers.parseConstraintsJson(text))).toEqual({
        ok: true,
        value: [
          { id: "C1", text: "Do not call `qsort`.", deduction: 3 },
          { id: "C2", text: "Write merge sort yourself.", deduction: 4 },
        ],
      });
    });

    it.each([
      ["malformed JSON", "[{"],
      ["not an array", JSON.stringify({ id: "C1", text: "x", deduction: 1 })],
      ["an empty array", "[]"],
      ["a missing id", JSON.stringify([{ text: "x", deduction: 1 }])],
      ["an empty text", JSON.stringify([{ id: "C1", text: "  ", deduction: 1 }])],
      ["a negative deduction", JSON.stringify([{ id: "C1", text: "x", deduction: -1 }])],
      ["a string deduction", JSON.stringify([{ id: "C1", text: "x", deduction: "3" }])],
      [
        "a duplicate id",
        JSON.stringify([
          { id: "C1", text: "x", deduction: 1 },
          { id: "C1", text: "y", deduction: 2 },
        ]),
      ],
    ])("rejects %s with a message", (_name, text) => {
      const out = helpers.parseConstraintsJson(text);
      expect(out.ok).toBe(false);
      expect(out.ok ? "" : out.error).not.toBe("");
    });
  });

  describe("pairTestFiles (tests/NN.in + tests/NN.out)", () => {
    it("pairs .in with .out by name, in name order", () => {
      const out = helpers.pairTestFiles([
        { name: "02.out", text: "2\n" },
        { name: "01.in", text: "1\n5\n" },
        { name: "02.in", text: "1\n2\n" },
        { name: "01.out", text: "5\n" },
      ]);
      expect(plain(out)).toEqual({
        ok: true,
        value: [
          { name: "01", input: "1\n5\n", expectedOutput: "5\n" },
          { name: "02", input: "1\n2\n", expectedOutput: "2\n" },
        ],
      });
    });

    it.each([
      ["no files", []],
      ["an .in without its .out", [{ name: "01.in", text: "1\n" }]],
      ["an .out without its .in", [{ name: "01.out", text: "1\n" }]],
      [
        "a file that is neither .in nor .out",
        [
          { name: "01.in", text: "1\n" },
          { name: "01.out", text: "1\n" },
          { name: "notes.txt", text: "" },
        ],
      ],
    ])("rejects %s with a message", (_name, files) => {
      const out = helpers.pairTestFiles(files);
      expect(out.ok).toBe(false);
      expect(out.ok ? "" : out.error).not.toBe("");
    });
  });

  it("embeds the helpers in the served page", () => {
    expect(renderAppHtml()).toContain(CLIENT_HELPERS);
  });

  it("serves a page script that parses (a typo in the template string is not a type error)", () => {
    const scripts = [...renderAppHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    expect(() => new Script(scripts[0] ?? "")).not.toThrow();
  });

  it("lets the TA enter the lab's statement, constraints and tests, with no built-in lab content", () => {
    const page = renderAppHtml();
    for (const id of [
      "labStatement",
      "labStatementFile",
      "labConstraints",
      "labConstraintsFile",
      "labTestFiles",
    ]) {
      expect(page).toContain(`id="${id}"`);
    }
    // No one-click lab with hard-coded content: the TA supplies the problem files.
    expect(page).not.toContain("createSortMergeLab");
    expect(page).not.toContain("Sort with a merge sort you wrote yourself");
  });
});
