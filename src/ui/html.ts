import { CLIENT_HELPERS } from "./client-helpers.js";

export function renderAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LeeTKOB — Constraint Review & Sandbox Judge</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    body { padding: 2rem 1rem; max-width: 1200px; margin: 0 auto; }
    header { margin-bottom: 2rem; border-bottom: 2px solid var(--pico-muted-border-color); padding-bottom: 1rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; font-size: 0.85rem; }
    .badge-pass { background-color: #2e7d32; color: #fff; }
    .badge-violation { background-color: #c62828; color: #fff; }
    .badge-unsure { background-color: #ef6c00; color: #fff; }
    .badge-ac { background-color: #1565c0; color: #fff; }
    .badge-wa { background-color: #d84315; color: #fff; }
    .evidence-box { background: #f5f5f5; border-left: 3px solid #c62828; padding: 0.5rem; margin: 0.5rem 0; font-family: monospace; font-size: 0.85rem; color: #333; white-space: pre-wrap; }
    .notice-box { background: #eef6ff; border-left: 4px solid #1565c0; padding: 0.75rem 1rem; margin: 1rem 0; font-size: 0.9rem; color: #1b2838; }
    .panel { border: 1px solid var(--pico-muted-border-color); border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; background: var(--pico-card-background-color); }
    pre { max-height: 250px; overflow-y: auto; font-size: 0.8rem; }
  </style>
</head>
<body>
  <header>
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
      <div>
        <h2>LeeTKOB · PA#3 Prototype</h2>
        <p><small>Constraint Review: Hard Rules first · Real LLM · TA Review Queue · Isolated Sandbox</small></p>
      </div>
      <div style="display:flex; gap:1rem; align-items:center;">
        <div>
          <label for="userSelect"><strong>Sign in as:</strong></label>
          <select id="userSelect" onchange="switchUser()">
            <option value="tok-ta-a">ta_a (TA · Class 1 — NMLT 23CTT1)</option>
            <option value="tok-ta-b">ta_b (TA · Class 2 — NMLT 23CTT2)</option>
            <option value="tok-stu1">stu1 (Student · Class 1)</option>
            <option value="tok-stu2">stu2 (Student · Class 1)</option>
            <option value="tok-admin">admin (Admin)</option>
          </select>
        </div>
        <div>
          <label for="labSelect"><strong>Active Lab:</strong></label>
          <select id="labSelect" onchange="selectLab()"></select>
        </div>
      </div>
    </div>
  </header>

  <main>
    <!-- TA SECTION -->
    <div id="taSection" class="panel">
      <h3>TA Dashboard (<span id="taClassLabel">Class 1</span>)</h3>
      <details open>
        <summary><strong>1. Create a lab in your class</strong></summary>
        <p><small>Load a problem's own files (for example <code>problems/sort-merge/</code>): its
        <code>statement.md</code>, its <code>constraints.json</code> and its <code>tests/*.in</code> + <code>*.out</code>.
        Every field stays editable before you create the lab.</small></p>
        <div class="grid">
          <label>Class id
            <input type="number" id="labClassId" min="1" step="1" />
          </label>
          <label>Lab name
            <input type="text" id="labName" placeholder="Lab 1 — Merge sort" />
          </label>
          <label>Closes at
            <input type="datetime-local" id="labClosesAt" />
          </label>
        </div>
        <label>Statement (<code>statement.md</code>)
          <input type="file" id="labStatementFile" accept=".md,.txt,text/markdown,text/plain" />
        </label>
        <textarea id="labStatement" rows="6" placeholder="Problem statement (Markdown)"></textarea>
        <label>Constraints with deductions (<code>constraints.json</code>: <code>[{ "id", "text", "deduction" }]</code>)
          <input type="file" id="labConstraintsFile" accept=".json,application/json" />
        </label>
        <textarea id="labConstraints" rows="6" placeholder='[{ "id": "C1", "text": "Do not call ...", "deduction": 3 }]'></textarea>
        <div id="labConstraintsPreview"></div>
        <label>Tests (select every <code>.in</code> and <code>.out</code> file)
          <input type="file" id="labTestFiles" accept=".in,.out" multiple />
        </label>
        <div id="labTestsPreview"><small><em>No test files chosen.</em></small></div>
        <button id="createLabButton" class="primary">Create lab</button>
        <div id="labCreatedStatus" style="margin-top:10px;"></div>
      </details>

      <div class="grid">
        <div>
          <h4>2. Publish Marks</h4>
          <p>Publishing refuses while any verdict is unreviewed or before close (<a href="https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-12" target="_blank" rel="noopener">FAQ-12</a>).</p>
          <button onclick="publishLab()" class="secondary">Publish Lab Marks</button>
          <div id="publishStatus" style="margin-top:10px;"></div>
        </div>
      </div>

      <hr />

      <h4>TA Review Queue</h4>
      <p><small>Verdicts appear here with evidence lines &amp; deductions. Students cannot see them before publishing (<a href="https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-08" target="_blank" rel="noopener">FAQ-08</a>).</small></p>
      <div id="reviewQueueContainer">
        <p><em>Loading review queue...</em></p>
      </div>
    </div>

    <!-- STUDENT SECTION -->
    <div id="studentSection" class="panel" style="display:none;">
      <h3>Student Submission Portal (<span id="studentUserLabel">stu1</span>)</h3>
      <div id="studentLabDetails"></div>
      <div class="notice-box">
        <strong>Notice (<a href="https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-06" target="_blank" rel="noopener">FAQ-06</a>):</strong>
        Your code will be compiled and tested in an isolated sandbox, then checked by hard rules and an AI model.
        Only the problem statement, constraints, and code with comments, names, and student IDs stripped are sent to the model.
        The model never decides deductions; your TA reviews all verdicts before marks are published.
      </div>

      <label>Load a <code>.cpp</code> file (or paste below)
        <input type="file" id="codeFile" accept=".cpp,.cc,.cxx,.h,.hpp,text/plain" />
      </label>

      <label for="codeEditor"><strong>C++ Source Code (max 64 KB):</strong></label>
      <textarea id="codeEditor" rows="10" placeholder="// Paste or write C++ code here..."></textarea>
      <button onclick="submitStudentCode()" class="primary">Submit Code to Queue</button>

      <div id="submissionResult" style="margin-top:1rem;"></div>
    </div>
  </main>

  <script>
${CLIENT_HELPERS}
    const POLL_INTERVAL_MS = 800;
    const POLL_MAX_ATTEMPTS = 150; // about 2 minutes
    let activeToken = 'tok-ta-a';
    let currentLabId = null;
    // The demo accounts' own class, used to prefill the Class id field (the server still checks it).
    const DEMO_CLASS_BY_TOKEN = { 'tok-ta-a': 1, 'tok-ta-b': 2 };
    let chosenTests = null; // result of pairTestFiles for the chosen files

    function readFileText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    }

    async function refreshLabs(preferredId) {
      const select = document.getElementById('labSelect');
      const res = await fetch('/v1/labs', { headers: { 'Authorization': 'Bearer ' + activeToken } });
      // Never keep the previous user's lab id: a user only works on labs the server lists for them.
      currentLabId = null;
      if (!res.ok) {
        select.innerHTML = '';
        return;
      }
      const data = await res.json();
      const labs = data.labs || [];
      select.innerHTML = labs.map(l =>
        '<option value="' + escapeHtml(l.id) + '">#' + escapeHtml(l.id) + ' — ' + escapeHtml(l.name || 'Lab') + '</option>'
      ).join('');
      currentLabId = pickLabId(labs, preferredId);
      if (currentLabId !== null) select.value = String(currentLabId);
    }

    async function loadSelectedLabDetails() {
      const container = document.getElementById('studentLabDetails');
      if (!currentLabId) { container.innerHTML = ''; return; }
      const res = await fetch('/v1/labs/' + currentLabId, {
        headers: { 'Authorization': 'Bearer ' + activeToken }
      });
      if (!res.ok) {
        container.innerHTML = '<p><em>Lab unavailable for your class.</em></p>';
        return;
      }
      const lab = await res.json();
      const cHtml = (lab.constraints || []).map(c =>
        '<li><strong>' + escapeHtml(c.id) + '</strong> (-' + escapeHtml(c.deduction) + ' pts): ' + escapeHtml(c.text) + '</li>'
      ).join('');
      container.innerHTML =
        '<article><h5>' + escapeHtml(lab.name || 'Lab') + '</h5>' +
        '<div style="white-space:pre-wrap;">' + escapeHtml(lab.statement || '') + '</div>' +
        '<ul>' + cHtml + '</ul></article>';
    }

    async function selectLab() {
      currentLabId = Number(document.getElementById('labSelect').value) || currentLabId;
      const isTa = activeToken.startsWith('tok-ta') || activeToken === 'tok-admin';
      if (isTa) {
        await fetchReviewQueue();
      } else {
        await loadSelectedLabDetails();
      }
    }

    async function switchUser() {
      activeToken = document.getElementById('userSelect').value;
      const isTa = activeToken.startsWith('tok-ta') || activeToken === 'tok-admin';
      document.getElementById('taSection').style.display = isTa ? 'block' : 'none';
      document.getElementById('studentSection').style.display = isTa ? 'none' : 'block';

      await refreshLabs();
      if (isTa) {
        const demoClass = DEMO_CLASS_BY_TOKEN[activeToken];
        document.getElementById('taClassLabel').innerText = demoClass ? 'Class ' + demoClass : 'all classes';
        document.getElementById('labClassId').value = demoClass ? String(demoClass) : '';
        await fetchReviewQueue();
      } else {
        document.getElementById('studentUserLabel').innerText = activeToken === 'tok-stu1' ? 'stu1' : 'stu2';
        await loadSelectedLabDetails();
      }
    }

    function defaultClosesAt() {
      // datetime-local wants local time "YYYY-MM-DDTHH:MM"
      const d = new Date(Date.now() + 86400000);
      d.setSeconds(0, 0);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    function renderConstraintsPreview() {
      const el = document.getElementById('labConstraintsPreview');
      const text = document.getElementById('labConstraints').value;
      if (!text.trim()) { el.innerHTML = ''; return null; }
      const parsed = parseConstraintsJson(text);
      if (!parsed.ok) {
        el.innerHTML = '<small style="color:red;">' + escapeHtml(parsed.error) + '</small>';
        return null;
      }
      el.innerHTML = '<ul>' + parsed.value.map(c =>
        '<li><strong>' + escapeHtml(c.id) + '</strong> (-' + escapeHtml(c.deduction) + ' pts): ' + escapeHtml(c.text) + '</li>'
      ).join('') + '</ul>';
      return parsed.value;
    }

    async function onTestFilesChosen(ev) {
      const el = document.getElementById('labTestsPreview');
      const files = Array.from(ev.target.files || []);
      const read = await Promise.all(files.map(async f => ({ name: f.name, text: await readFileText(f) })));
      const paired = pairTestFiles(read);
      chosenTests = paired.ok ? paired.value : null;
      el.innerHTML = paired.ok
        ? '<small>' + paired.value.length + ' tests: ' + paired.value.map(t =>
            escapeHtml(t.name) + ' (' + t.input.length + ' B in / ' + t.expectedOutput.length + ' B out)'
          ).join(', ') + '</small>'
        : '<small style="color:red;">' + escapeHtml(paired.error) + '</small>';
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + activeToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      let data = {};
      try { data = await res.json(); } catch (err) { /* empty or non-JSON body */ }
      return { ok: res.ok, status: res.status, data };
    }

    async function createLab() {
      const statusEl = document.getElementById('labCreatedStatus');
      const fail = (msg) => { statusEl.innerHTML = '<span style="color:red;">' + escapeHtml(msg) + '</span>'; };

      const classId = Number(document.getElementById('labClassId').value);
      const name = document.getElementById('labName').value.trim();
      const statement = document.getElementById('labStatement').value;
      const closesRaw = document.getElementById('labClosesAt').value;
      const closesAt = closesRaw ? new Date(closesRaw) : null;
      if (!Number.isInteger(classId) || classId < 1) return fail('Class id must be a positive integer.');
      if (!name) return fail('Give the lab a name.');
      if (!statement.trim()) return fail('Load or type the statement.');
      if (!closesAt || Number.isNaN(closesAt.getTime())) return fail('Choose when the lab closes.');
      const parsedConstraints = parseConstraintsJson(document.getElementById('labConstraints').value);
      if (!parsedConstraints.ok) return fail('Constraints: ' + parsedConstraints.error);
      if (!chosenTests) return fail('Tests: choose the matching .in and .out files.');

      const button = document.getElementById('createLabButton');
      button.disabled = true;
      statusEl.innerHTML = '<span>Creating lab...</span>';
      try {
        const lab = await postJson('/v1/labs', { classId, name, statement, closesAt: closesAt.toISOString() });
        if (!lab.ok) return fail('Lab not created: ' + (lab.data.detail || lab.data.title || lab.status));
        const labId = lab.data.id;

        for (const c of parsedConstraints.value) {
          const r = await postJson('/v1/labs/' + labId + '/constraints', c);
          if (!r.ok) return fail('Lab #' + labId + ' created, but constraint ' + c.id + ' was refused: ' + (r.data.detail || r.status));
        }
        for (const t of chosenTests) {
          const r = await postJson('/v1/labs/' + labId + '/tests', { input: t.input, expectedOutput: t.expectedOutput });
          if (!r.ok) return fail('Lab #' + labId + ' created, but test ' + t.name + ' was refused: ' + (r.data.detail || r.status));
        }

        await refreshLabs(labId);
        statusEl.innerHTML = '<span style="color:green;">&#10003; Lab #' + escapeHtml(labId) + ' created in class ' +
          escapeHtml(classId) + ' with ' + parsedConstraints.value.length + ' constraints and ' + chosenTests.length + ' tests.</span>';
        await fetchReviewQueue();
      } catch (err) {
        fail('Network error while creating the lab.');
      } finally {
        button.disabled = false;
      }
    }

    document.getElementById('labStatementFile').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) document.getElementById('labStatement').value = await readFileText(f);
    });
    document.getElementById('labConstraintsFile').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) document.getElementById('labConstraints').value = await readFileText(f);
      renderConstraintsPreview();
    });
    document.getElementById('labConstraints').addEventListener('input', renderConstraintsPreview);
    document.getElementById('labTestFiles').addEventListener('change', onTestFilesChosen);
    document.getElementById('createLabButton').addEventListener('click', createLab);
    document.getElementById('codeFile').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) document.getElementById('codeEditor').value = await readFileText(f);
    });
    document.getElementById('labClosesAt').value = defaultClosesAt();

    async function submitStudentCode() {
      const code = document.getElementById('codeEditor').value;
      if (!code) { alert('Please enter code'); return; }
      const resultEl = document.getElementById('submissionResult');
      if (currentLabId === null) {
        resultEl.innerHTML = '<p style="color:red;">No lab is open in your class yet.</p>';
        return;
      }

      resultEl.innerHTML = '<p>Submitting to queue...</p>';
      const res = await fetch('/v1/labs/' + currentLabId + '/submissions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + activeToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!res.ok) {
        resultEl.innerHTML = '<p style="color:red;">Error: ' + escapeHtml(data.detail || data.title || res.status) + '</p>';
        return;
      }

      const subId = data.id;
      resultEl.innerHTML =
        '<p>Submission #' + escapeHtml(subId) + ' status: <strong class="badge badge-unsure">queued</strong> (waiting for worker judge...)</p>';

      // Poll until judged, an error, or the time limit; never poll forever.
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const fail = (msg) => {
          clearInterval(interval);
          resultEl.innerHTML = '<p style="color:red;">Submission #' + escapeHtml(subId) + ': ' + escapeHtml(msg) + '</p>';
        };
        try {
          const sRes = await fetch('/v1/submissions/' + encodeURIComponent(subId), {
            headers: { 'Authorization': 'Bearer ' + activeToken }
          });
          if (!sRes.ok) return fail('could not read status (HTTP ' + sRes.status + ').');
          const sub = await sRes.json();
          if (sub.status === 'judged') {
            clearInterval(interval);
            const badge = testVerdictBadge(sub.testVerdict);
            resultEl.innerHTML =
              '<div>' +
                '<h4>Submission #' + escapeHtml(sub.id) + ' Judged!</h4>' +
                '<p>Status: <span class="badge badge-pass">' + escapeHtml(sub.status) + '</span> | Test Verdict: <span class="badge ' + badge.cls + '">' + escapeHtml(badge.label) + '</span></p>' +
                '<p><small><em>Notice (<a href="https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-08" target="_blank" rel="noopener">FAQ-08</a>): Constraint review verdicts remain hidden until the TA publishes marks.</em></small></p>' +
              '</div>';
          } else if (attempts >= POLL_MAX_ATTEMPTS) {
            fail('still not judged after 2 minutes. Ask your TA to check the judge worker.');
          }
        } catch (err) {
          fail('network error while checking status.');
        }
      }, POLL_INTERVAL_MS);
    }

    async function fetchReviewQueue() {
      const el = document.getElementById('reviewQueueContainer');
      if (currentLabId === null) {
        el.innerHTML = '<p><em>No lab in your class yet. Create one above.</em></p>';
        return;
      }
      const res = await fetch('/v1/labs/' + currentLabId + '/reviews', {
        headers: { 'Authorization': 'Bearer ' + activeToken }
      });
      if (!res.ok) {
        el.innerHTML = '<p style="color:red;">Unable to load review queue (Status ' + escapeHtml(res.status) + '). If TA of another class, access is refused (404).</p>';
        return;
      }
      const data = await res.json();
      if (!data.items || data.items.length === 0) {
        el.innerHTML = '<p><em>No submissions currently in Lab #' + escapeHtml(currentLabId) + ' review queue.</em></p>';
        return;
      }

      let html = '<table role="grid"><thead><tr>' +
        '<th>Sub #</th><th>Constraint</th><th>Verdict</th><th>Decided By</th><th>Deduction</th><th>Evidence</th><th>Action</th>' +
        '</tr></thead><tbody>';

      for (const item of data.items) {
        const vClass = item.verdict === 'pass' ? 'badge-pass' : (item.verdict === 'violation' ? 'badge-violation' : 'badge-unsure');
        let evHtml = '<em>none</em>';
        if (item.evidence && item.evidence.length > 0) {
          evHtml = item.evidence.map(e =>
            '<div class="evidence-box">L' + escapeHtml(e.line) + ': ' + escapeHtml(e.text) + '</div>'
          ).join('');
        }
        const reasonNote = item.unsureReason ? '<div><small>Reason: ' + escapeHtml(item.unsureReason) + '</small></div>' : '';

        const actionHtml = item.reviewed
          ? '<span style="color:green;">&#10003; Confirmed</span>'
          : (item.verdict === 'unsure'
              ? '<button class="outline review-btn" data-sub="' + escapeHtml(item.submissionId) + '" data-cid="' + escapeHtml(item.constraintId) + '" data-verdict="pass" style="padding:4px 8px; font-size:0.8rem;">Confirm Pass</button> ' +
                '<button class="outline secondary review-viol-btn" data-sub="' + escapeHtml(item.submissionId) + '" data-cid="' + escapeHtml(item.constraintId) + '" style="padding:4px 8px; font-size:0.8rem;">Mark Violation</button>'
              : '<button class="outline review-btn" data-sub="' + escapeHtml(item.submissionId) + '" data-cid="' + escapeHtml(item.constraintId) + '" data-verdict="' + escapeHtml(item.verdict) + '" style="padding:4px 8px; font-size:0.8rem;">Confirm</button>');

        html += '<tr>' +
          '<td>#' + escapeHtml(item.submissionId) + '</td>' +
          '<td><strong>' + escapeHtml(item.constraintId) + '</strong></td>' +
          '<td><span class="badge ' + vClass + '">' + escapeHtml(item.verdict) + '</span>' + reasonNote + '</td>' +
          '<td>' + escapeHtml(item.decidedBy) + '</td>' +
          '<td>-' + escapeHtml(item.deduction) + ' pts</td>' +
          '<td>' + evHtml + '</td>' +
          '<td>' + actionHtml + '</td>' +
        '</tr>';
      }
      html += '</tbody></table>';
      el.innerHTML = html;

      el.querySelectorAll('.review-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          approveReview(btn.getAttribute('data-sub'), btn.getAttribute('data-cid'), btn.getAttribute('data-verdict'));
        });
      });
      el.querySelectorAll('.review-viol-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          markViolationWithEvidence(btn.getAttribute('data-sub'), btn.getAttribute('data-cid'));
        });
      });
    }

    async function markViolationWithEvidence(subId, constrId) {
      const lineRaw = prompt('Enter 1-based evidence line number (FAQ-09):');
      const lineNum = Number(lineRaw);
      if (!Number.isInteger(lineNum) || lineNum < 1) { alert('Valid positive integer line number required.'); return; }
      const text = prompt('Enter exact offending source line text:');
      if (!text) { alert('Evidence text is required.'); return; }
      await fetch('/v1/labs/' + currentLabId + '/reviews/' + encodeURIComponent(subId) + '/' + encodeURIComponent(constrId), {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + activeToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict: 'violation', evidence: [{ line: lineNum, text }] })
      });
      await fetchReviewQueue();
    }

    async function approveReview(subId, constrId, verdict) {
      await fetch('/v1/labs/' + currentLabId + '/reviews/' + encodeURIComponent(subId) + '/' + encodeURIComponent(constrId), {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + activeToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict })
      });
      await fetchReviewQueue();
    }

    async function publishLab() {
      if (currentLabId === null) {
        document.getElementById('publishStatus').innerHTML = '<span style="color:red;">No lab in this class to publish.</span>';
        return;
      }
      const res = await fetch('/v1/labs/' + currentLabId + '/publish', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + activeToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('publishStatus').innerHTML = '<span style="color:green;">&#10003; Marks successfully published!</span>';
      } else {
        document.getElementById('publishStatus').innerHTML = '<span style="color:red;">Publish refused: ' + escapeHtml(data.detail || data.title) + '</span>';
      }
    }

    switchUser();
  </script>
</body>
</html>`;
}
