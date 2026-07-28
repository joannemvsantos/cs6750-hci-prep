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
  const key = kind === 'weeklyDeliverables' ? item.week : item.label;
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

function weekDetailRow(item) {
  return `<div class="item-row toggleable ${item.done ? 'done' : ''}" data-kind="weekDetail" data-key="${escapeHtml(item.key)}">
    <div class="box"></div><span class="txt">${escapeHtml(item.label)}</span>
  </div>`;
}

function detailChecklist(title, items) {
  if (!items || !items.length) return '';
  return `<h4>${title}</h4>${items.map(weekDetailRow).join('')}`;
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
  const detailDone = state.weekDetail.filter((i) => i.done).length;
  const dailyDone = state.daily.filter((d) => d.done).length;
  const fallPrepDone = state.fallPrep.filter((f) => f.done).length;

  let summaryHtml = '<div class="grade-grid">';
  summaryHtml += `<div class="grade-tile"><div class="pct">${wkDone}/${state.weeklyDeliverables.length}</div><div class="name">Weekly deliverables</div></div>`;
  summaryHtml += `<div class="grade-tile"><div class="pct">${detailDone}/${state.weekDetail.length}</div><div class="name">Checklist items done</div></div>`;
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
  // click anywhere else on the card to expand/collapse its Content/Reading/Assignments/Participation
  // checklist (Reading is the former standalone Required Reading List, now folded in per week).
  let weeksHtml = '';
  state.weeklyDeliverables.forEach((wk) => {
    const s = weekStatus(wk, today);
    const isOpen = expandedWeeks.has(wk.week);
    const d = wk.detail || {};
    const bodyHtml = detailChecklist('Content', d.content) + detailChecklist('Reading', d.reading) + detailChecklist('Assignments', d.assignments) + detailChecklist('Participation / misc', d.misc);
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
  // Highest priority: anything with a data-kind is a toggle target — the week's own
  // checkbox, a weekDetail checklist row inside an expanded card, or a Reading/Habits row.
  // Checking this first means clicks inside the expanded detail checklist never get
  // mistaken for a card-expand click.
  const toggleTarget = e.target.closest('[data-kind]');
  if (toggleTarget) {
    toggle(toggleTarget.dataset.kind, toggleTarget.dataset.key);
    return;
  }

  // Otherwise, clicking the summary strip of a week card (title/badge/due/status/chevron,
  // but not the checkbox — that was already handled above) expands/collapses its detail.
  const summary = e.target.closest('.wk-summary');
  if (summary) {
    const card = summary.closest('.week-card');
    const wk = Number(card.dataset.week);
    if (expandedWeeks.has(wk)) expandedWeeks.delete(wk); else expandedWeeks.add(wk);
    if (lastState) render(lastState);
  }
});

poll();
setInterval(poll, POLL_MS);
