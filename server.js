// CS6750 HCI dashboard — local server
// Reads C:\Users\joann\Documents\Obsidian Vault\obsidian-vault\Backlog\🎓 OMSCS Backlog.md
// directly off disk on every request. No writes, no database, no cloud —
// your Obsidian vault is the only source of truth. Same pattern as rock-n-roll-expenses.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 5180;
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'vault-config.json'), 'utf8'));
const BACKLOG_FILE = config.backlogFile;

function parseBacklog(raw) {
  const lines = raw.split(/\r?\n/);
  let section = '';
  let subsection = '';

  const weeklyDeliverables = [];
  const readingList = [];
  const daily = [];
  const weekly = [];
  const fallPrep = [];
  const backlogIdeas = [];
  let semesterStart = null;
  let lectureProgress = null;

  const wkRe = /^- \[([ xX])\] CS6750 Wk(\d+) \(([^)]+)\): next (\d{4}-\d{2}-\d{2})/;
  const readingRe = /^- \[([ xX])\] Week (\d+) — (.+)$/;
  const checkboxRe = /^- \[([ xX])\] (.+)$/;
  const semesterRe = /Semester start:.*?(\d{4}-\d{2}-\d{2})/;
  const lectureRe = /Current lecture progress: (.+)$/;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('## ')) {
      section = trimmed.replace(/^##\s*/, '');
      subsection = '';
      continue;
    }
    if (trimmed.startsWith('### ')) {
      // sub-headings inside a section (e.g. "Week-by-week pattern") — keep parent section
      continue;
    }
    if (/^\*\*Test 1 material\*\*/.test(trimmed)) { subsection = 'Test 1'; continue; }
    if (/^\*\*Test 2 material\*\*/.test(trimmed)) { subsection = 'Test 2'; continue; }

    const semMatch = trimmed.match(semesterRe);
    if (semMatch) semesterStart = semMatch[1];
    const lecMatch = trimmed.match(lectureRe);
    if (lecMatch) lectureProgress = lecMatch[1];

    const wkMatch = trimmed.match(wkRe);
    if (wkMatch) {
      weeklyDeliverables.push({
        week: parseInt(wkMatch[2], 10),
        label: wkMatch[3],
        due: wkMatch[4],
        done: wkMatch[1].toLowerCase() === 'x'
      });
      continue;
    }

    if (section.startsWith('Required Reading List')) {
      const rMatch = trimmed.match(readingRe);
      if (rMatch) {
        readingList.push({
          week: parseInt(rMatch[2], 10),
          test: subsection || null,
          label: rMatch[3],
          done: rMatch[1].toLowerCase() === 'x'
        });
        continue;
      }
    }

    const cMatch = trimmed.match(checkboxRe);
    if (cMatch) {
      const item = { label: cMatch[2], done: cMatch[1].toLowerCase() === 'x' };
      if (section === 'Daily') daily.push(item);
      else if (section === 'Weekly') weekly.push(item);
      else if (section.startsWith('Now')) fallPrep.push(item);
      else if (section.startsWith('Backlog ideas')) backlogIdeas.push(item);
    }
  }

  return { weeklyDeliverables, readingList, daily, weekly, fallPrep, backlogIdeas, semesterStart, lectureProgress };
}

function buildState() {
  const raw = fs.readFileSync(BACKLOG_FILE, 'utf8');
  const parsed = parseBacklog(raw);
  const allItems = [
    ...parsed.weeklyDeliverables,
    ...parsed.readingList,
    ...parsed.daily,
    ...parsed.weekly,
    ...parsed.fallPrep,
    ...parsed.backlogIdeas
  ];
  const done = allItems.filter((i) => i.done).length;
  return {
    ...parsed,
    totals: { done, total: allItems.length },
    syncedAt: new Date().toISOString()
  };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  if (req.url === '/api/state') {
    try {
      const state = buildState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath.split('?')[0]);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`CS6750 dashboard running at http://localhost:${PORT}`);
  console.log(`Reading: ${BACKLOG_FILE}`);
  console.log('Leave this window open. Close it to stop the dashboard.');
  exec(`start http://localhost:${PORT}`);
});
