/**
 * Plain-JS helpers embedded in the served page. Kept as a source string so unit tests evaluate
 * exactly what the browser runs (test/unit/ui.test.ts).
 */
export const CLIENT_HELPERS = `
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function testVerdictBadge(verdict) {
  if (!verdict) return { cls: "badge-unsure", label: "unknown" };
  return { cls: verdict === "AC" ? "badge-ac" : "badge-wa", label: String(verdict) };
}

// The lab to show from the user's own lab list: the preferred one if listed, else the newest,
// else none. Never a lab id the server did not list for this user.
function pickLabId(labs, preferredId) {
  if (!Array.isArray(labs) || labs.length === 0) return null;
  const wanted = Number(preferredId);
  if (preferredId != null && labs.some((l) => l.id === wanted)) return wanted;
  return labs[labs.length - 1].id;
}

// constraints.json as published with each problem: [{ "id", "text", "deduction" }, ...].
function parseConstraintsJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: "constraints are not valid JSON." };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: "constraints must be a non-empty JSON array." };
  }
  const seen = new Set();
  const value = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const where = "constraint #" + (i + 1);
    if (!c || typeof c !== "object") return { ok: false, error: where + " is not an object." };
    if (typeof c.id !== "string" || c.id.trim() === "") {
      return { ok: false, error: where + " needs a non-empty string id." };
    }
    if (typeof c.text !== "string" || c.text.trim() === "") {
      return { ok: false, error: where + " (" + c.id + ") needs a non-empty text." };
    }
    if (typeof c.deduction !== "number" || !Number.isFinite(c.deduction) || c.deduction < 0) {
      return { ok: false, error: where + " (" + c.id + ") needs a deduction >= 0 (a number)." };
    }
    if (seen.has(c.id)) return { ok: false, error: "constraint id " + c.id + " appears twice." };
    seen.add(c.id);
    value.push({ id: c.id, text: c.text, deduction: c.deduction });
  }
  return { ok: true, value };
}

// Test files as published with each problem: NN.in + NN.out, paired by the name before the dot.
function pairTestFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: "choose the test files (.in and .out)." };
  }
  const inputs = new Map();
  const outputs = new Map();
  for (const f of files) {
    if (f.name.endsWith(".in")) inputs.set(f.name.slice(0, -3), f.text);
    else if (f.name.endsWith(".out")) outputs.set(f.name.slice(0, -4), f.text);
    else return { ok: false, error: f.name + " is neither a .in nor a .out file." };
  }
  for (const name of inputs.keys()) {
    if (!outputs.has(name)) return { ok: false, error: name + ".in has no " + name + ".out." };
  }
  for (const name of outputs.keys()) {
    if (!inputs.has(name)) return { ok: false, error: name + ".out has no " + name + ".in." };
  }
  const names = Array.from(inputs.keys()).sort();
  return {
    ok: true,
    value: names.map((name) => ({ name, input: inputs.get(name), expectedOutput: outputs.get(name) })),
  };
}
`;
