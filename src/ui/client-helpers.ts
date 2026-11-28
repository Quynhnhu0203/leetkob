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
`;
