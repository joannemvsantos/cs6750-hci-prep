const POLL_MS = 5000;
let pending = false; // true while a toggle click is in flight, to avoid double-clicks racing
let lastState = null; // most recent /api/state payload, so expand/collapse can re-render without a refetch
const expandedWeeks = new Set(); // week numbers currently expanded in the 17-Week Plan tab

const tabButtons = document.querySelectorAll('nav.tabs button');
const panels = document.querySelectorAll('section.panel');
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function itemRow(item, kind) {
  const key = (kind === 'weeklyDeliverables' || kind === 'readingList') ? item.week : item.label;
  return `<div class="item-row toggleable ${item.done ? 'done' : ''}" data-kind="${kind}" data-key="${escapeHtml(key)}">
    <div class="box"></div><span class="txt">${escapeHtml(item.label)}</span>
  </div>`;
}

function weekStatus(wk, today) {
  if (wk.done) return { cls: 'status-done', label: 'Done' };
  const due = new Date(wk.due + 'T23:59:59');
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { cls: 'status-overdue', label: 'Overdue' };
  if (diffDays <= 6) return { cls: 'status-due', label: 'Due this week' };
  return { cls: 'status-upcoming', label: 'Upcoming' };
}

function detailBlock(title, items) {
  if (!items || !items.length) return '';
  return `<h4>${title}</h4><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function render(state) {
  lastState = state;
  const today = new Date();

  // Hero
  document.getElementById('heroSub').textContent =
    state.lectureProgress ? `Current lecture progress: ${state.lectureProgress}` : 'Synced from your Obsidian vault.';

  if (state.semesterStart) {
    const target = new Date(state.semesterStart + 'T00:00:00');
    const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    document.getElementById('daysLeft').textContent = diff > 0 ? diff : 0;
  }

  const pct = state.totals.total ? Math.round((state.totals.done / state.totals.total) * 100) : 0;
  document.getElementById('overallPct').textContent = pct + '%';
  document.getElementById('overallBar').style.width = pct + '%';
  document.getElementById('overallCaption').textContent = `${state.totals.done} of ${state.totals.total} vault checkboxes checked`;
  document.getElementById('syncLine').textContent = `Last synced ${new Date(state.syncedAt).toLocaleTimeString()} — polling your vault every 5s · click any item to check it off (writes straight to Obsidian)`;

  // Dashboard tab summary
  const wkDone = state.weeklyDeliverables.filter((w) => w.done).length;
  const overdue = state.weeklyDeliverables.filter((w) => !w.done && weekStatus(w, today).cls === 'status-overdue');
  const dueSoon = state.weeklyDeliverables.filter((w) => !w.done && weekStatus(w, today).cls === 'status-due');
  const readDone = state.readingList.filter((r) => r.done).length;
  const dailyDone = state.daily.filter((d) => d.done).length;
  const fallPrepDone = state.fallPrep.filter((f) => f.done).length;

  let summaryHtml = '<div class="grade-grid">';
  summaryHtml += `<div class="grade-tile"><div class="pct">${wkDone}/${state.weeklyDeliverables.length}</div><div class="name">Weekly deliverables</div></div>`;
  summaryHtml += `<div class="grade-tile"><div class="pct">${readDone}/${state.readingList.length}</div><div class="name">Readings done</div></div>`;
  summaryHtml += `<div class="grade-tile"><div class="pct">${dailyDone}/${state.daily.length}</div><div class="name">Daily habit</div></div>`;
  summaryHtml += `<div class="grade-tile"><div class="pct">${fallPrepDone}/${state.fallPrep.length}</div><div class="name">Fall prep</div></div>`;
  summaryHtml += '</div>';

  if (overdue.length) {
    summaryHtml += `<div class="error-box" style="margin-top:14px;">⚠️ ${overdue.length} weekly deliverable${overdue.length > 1 ? 's are' : ' is'} overdue in the vault: ${overdue.map((w) => `Wk${w.week} (${escapeHtml(w.label)})`).join(', ')}</div>`;
  } else if (dueSoon.length) {
    summaryHtml += `<div class="a-callout" style="margin-top:14px;">📅 Due this week: ${dueSoon.map((w) => `Wk${w.week} — ${escapeHtml(w.label)}`).join(', ')}</div>`;
  } else {
    summaryHtml += `<div class="a-callout" style="margin-top:14px;">Nothing overdue right now. Next up: ${nextUpcoming(state.weeklyDeliverables, today)}</div>`;
  }
  document.getElementById('dashboardSummary').innerHTML = summaryHtml;

  // Weeks tab — click the checkbox to mark a week done (writes to the vault);
  // click anywhere else on the card to expand/collapse its Content/Assignments/Participation detail.
  let weeksHtml = '';
  state.weeklyDeliverables.forEach((wk) => {
    const s = weekStatus(wk, today);
    const isOpen = expandedWeeks.has(wk.week);
    const d = wk.detail || {};
    const bodyHtml = detailBlock('Content', d.content) + detailBlock('Assignments', d.assignments) + detailBlock('Participation / misc', d.misc);
    weeksHtml += `
      <div class="week-card ${wk.done ? 'done' : ''} ${isOpen ? 'open' : ''}" data-week="${wk.week}">
        <div class="wk-summary">
          <div class="wk-left">
            <div class="box toggle-box" data-kind="weeklyDeliverables" data-key="${wk.week}"></div>
            <div class="wk-badge">WK ${wk.week}</div>
            <div>
              <div class="wk-title">${escapeHtml(wk.label)}</div>
              <div class="wk-due">Due ${wk.due} 11:59pm AoE</div>
            </div>
          </div>
          <div class="wk-right">
            <div class="status-pill ${s.cls}">${s.label}</div>
            <div class="chevron">${isOpen ? '▲' : '▼'}</div>
          </div>
        </div>
        ${isOpen && bodyHtml ? `<div class="wk-body">${bodyHtml}</div>` : ''}
      </div>`;
  });
  document.getElementById('weeksContainer').innerHTML = weeksHtml;

  // Reading tab
  const test1 = state.readingList.filter((r) => r.test === 'Test 1');
  const test2 = state.readingList.filter((r) => r.test === 'Test 2');
  let readingHtml = '<div class="card"><div class="section-block"><h4>Test 1 material (Weeks 1–6)</h4>';
  readingHtml += test1.map((r) => itemRow(r, 'readingList')).join('');
  readingHtml += '</div><div class="section-block"><h4>Test 2 material (Weeks 7–13)</h4>';
  readingHtml += test2.map((r) => itemRow(r, 'readingList')).join('');
  readingHtml += '</div></div>';
  document.getElementById('readingContainer').innerHTML = readingHtml;

  // Habits tab
  let habitsHtml = '<div class="card"><div class="section-block"><h4>Daily</h4>';
  habitsHtml += state.daily.map((d) => itemRow(d, 'daily')).join('');
  habitsHtml += '</div><div class="section-block"><h4>Weekly</h4>';
  habitsHtml += state.weekly.map((w) => itemRow(w, 'weekly')).join('');
  habitsHtml += '</div><div class="section-block"><h4>Now — Fall Prep</h4>';
  habitsHtml += state.fallPrep.map((f) => itemRow(f, 'fallPrep')).join('');
  habitsHtml += '</div><div class="section-block"><h4>Backlog ideas</h4>';
  habitsHtml += state.backlogIdeas.map((b) => itemRow(b, 'backlogIdeas')).join('');
  habitsHtml += '</div></div>';
  document.getElementById('habitsContainer').innerHTML = habitsHtml;
}

function nextUpcoming(weeklyDeliverables, today) {
  const upcoming = weeklyDeliverables
    .filter((w) => !w.done)
    .sort((a, b) => new Date(a.due) - new Date(b.due))[0];
  return upcoming ? `Wk${upcoming.week} — ${escapeHtml(upcoming.label)} (due ${upcoming.due})` : 'everything checked off 🎉';
}

async function poll() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const state = await res.json();
    if (state.error) throw new Error(state.error);
    render(state);
  } catch (e) {
    document.getElementById('dashboardSummary').innerHTML =
      `<div class="error-box">Couldn't read the vault file: ${escapeHtml(e.message)}. Check vault-config.json points at the right path and that the file is accessible.</div>`;
    document.getElementById('syncLine').textContent = 'Sync failed — retrying…';
  }
}

async function toggle(kind, key) {
  if (pending) return;
  pending = true;
  document.getElementById('syncLine').textContent = 'Saving to your vault…';
  try {
    const res = await fetch('/api/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, key })
    });
    const state = await res.json();
    if (!res.ok || state.error) throw new Error(state.error || 'Toggle failed');
    render(state);
  } catch (e) {
    document.getElementById('syncLine').textContent = `Couldn't save: ${e.message}`;
  } finally {
    pending = false;
  }
}

document.addEventListener('click', (e) => {
  // Week cards: checkbox toggles done state, the rest of the card expands/collapses detail.
  const weekCard = e.target.closest('.week-card');
  if (weekCard) {
    const box = e.target.closest('.toggle-box');
    if (box) {
      toggle(box.dataset.kind, box.dataset.key);
      return;
    }
    const wk = Number(weekCard.dataset.week);
    if (expandedWeeks.has(wk)) expandedWeeks.delete(wk); else expandedWeeks.add(wk);
    if (lastState) render(lastState);
    return;
  }

  // Everything else (Reading tab / Habits tab rows): whole row toggles.
  const row = e.target.closest('[data-kind]');
  if (!row) return;
  toggle(row.dataset.kind, row.dataset.key);
});

poll();
setInterval(poll, POLL_MS);
