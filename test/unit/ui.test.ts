import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CLIENT_HELPERS } from "../../src/ui/client-helpers.js";
import { renderAppHtml } from "../../src/ui/html.js";

interface Helpers {
  escapeHtml(value: unknown): string;
  testVerdictBadge(verdict: unknown): { cls: string; label: string };
  pickLabId(labs: unknown, preferredId?: unknown): number | null;
}

// Evaluate the exact source the browser runs, not a TypeScript copy of it.
const helpers = runInNewContext(
  `${CLIENT_HELPERS}; ({ escapeHtml, testVerdictBadge, pickLabId })`,
) as Helpers;

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

  it("embeds the helpers in the served page", () => {
    expect(renderAppHtml()).toContain(CLIENT_HELPERS);
  });
});
