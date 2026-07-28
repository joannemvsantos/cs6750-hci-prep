// CS6750 HCI dashboard — local server
// Reads AND writes C:\Users\joann\Documents\Obsidian Vault\obsidian-vault\Backlog\🎓 OMSCS Backlog.md
// directly on disk. Your Obsidian vault is the only database — checking a box here edits that
// exact line in the file (nothing else in the file is touched), and checking it in Obsidian shows
// up here within 5 seconds. Same pattern as rock-n-roll-expenses.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 5180;
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'vault-config.json'), 'utf8'));
const BACKLOG_FILE = config.backlogFile;

const WK_RE = /^- \[([ xX])\] CS6750 Wk(\d+) \(([^)]+)\): next (\d{4}-\d{2}-\d{2})/;
const READING_RE = /^- \[([ xX])\] Week (\d+) — (.+)$/;
const CHECKBOX_RE = /^- \[([ xX])\] (.+)$/;
const SEMESTER_RE = /Semester start:.*?(\d{4}-\d{2}-\d{2})/;
const LECTURE_RE = /Current lecture progress: (.+)$/;

// Walks every line of the Backlog file, tracking which ## section (and, inside the
// Required Reading List, which **Test N material** subsection) each line belongs to.
// Calls onItem(...) for every checkbox-syntax line found, with enough info to both
// render it (parsing) and find it again later (toggling).
function walkLines(lines, onItem) {
  let section = '';
  let subsection = '';

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('## ')) { section = trimmed.replace(/^##\s*/, ''); subsection = ''; return; }
    if (trimmed.startsWith('### ')) return; // sub-heading, keep parent section
    if (/^\*\*Test 1 material\*\*/.test(trimmed)) { subsection = 'Test 1'; return; }
    if (/^\*\*Test 2 material\*\*/.test(trimmed)) { subsection = 'Test 2'; return; }

    const wkMatch = trimmed.match(WK_RE);
    if (wkMatch) {
      onItem({
        idx, kind: 'weeklyDeliverables', key: parseInt(wkMatch[2], 10),
        label: wkMatch[3], due: wkMatch[4], done: wkMatch[1].toLowerCase() === 'x'
      });
      return;
    }

    if (section.startsWith('Required Reading List')) {
      const rMatch = trimmed.match(READING_RE);
      if (rMatch) {
        onItem({
          idx, kind: 'readingList', key: parseInt(rMatch[2], 10),
          test: subsection || null, label: rMatch[3], done: rMatch[1].toLowerCase() === 'x'
        });
        return;
      }
    }

    const cMatch = trimmed.match(CHECKBOX_RE);
    if (cMatch) {
      let kind = null;
      if (section === 'Daily') kind = 'daily';
      else if (section === 'Weekly') kind = 'weekly';
      else if (section.startsWith('Now')) kind = 'fallPrep';
      else if (section.startsWith('Backlog ideas')) kind = 'backlogIdeas';
      if (kind) {
        onItem({ idx, kind, key: cMatch[2], label: cMatch[2], done: cMatch[1].toLowerCase() === 'x' });
      }
    }
  });
}

function splitLines(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { lines: raw.split(/\r?\n/), eol };
}

function buildState() {
  const raw = fs.readFileSync(BACKLOG_FILE, 'utf8');
  const { lines } = splitLines(raw);

  const groups = { weeklyDeliverables: [], readingList: [], daily: [], weekly: [], fallPrep: [], backlogIdeas: [] };
  walkLines(lines, (item) => groups[item.kind].push(item));

  let semesterStart = null;
  let lectureProgress = null;
  for (const line of lines) {
    const semMatch = line.match(SEMESTER_RE);
    if (semMatch) semesterStart = semMatch[1];
    const lecMatch = line.match(LECTURE_RE);
    if (lecMatch) lectureProgress = lecMatch[1];
  }

  const allItems = Object.values(groups).flat();
  const done = allItems.filter((i) => i.done).length;

  return {
    ...groups,
    semesterStart,
    lectureProgress,
    totals: { done, total: allItems.length },
    syncedAt: new Date().toISOString()
  };
}

// Flips exactly one checkbox in the vault file — the line identified by (kind, key) —
// and rewrites the file with that single character changed. Everything else in the
// file (formatting, other lines, emoji, etc.) is left byte-for-byte as it was.
function toggleItem(kind, key) {
  const raw = fs.readFileSync(BACKLOG_FILE, 'utf8');
  const { lines, eol } = splitLines(raw);

  let targetIdx = -1;
  walkLines(lines, (item) => {
    if (targetIdx !== -1 || item.kind !== kind) return;
    const matches = (kind === 'weeklyDeliverables' || kind === 'readingList')
      ? item.key === Number(key)
      : item.key === key;
    if (matches) targetIdx = item.idx;
  });

  if (targetIdx === -1) {
    throw new Error(`Couldn't find a "${kind}" checkbox matching "${key}" — the vault file may have changed. Reload and try again.`);
  }

  lines[targetIdx] = lines[targetIdx].replace(/\[([ xX])\]/, (m, c) => (c.trim() === '' ? '[x]' : '[ ]'));
  fs.writeFileSync(BACKLOG_FILE, lines.join(eol));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/state') {
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

  if (req.method === 'POST' && req.url === '/api/toggle') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { kind, key } = JSON.parse(body || '{}');
        toggleItem(kind, key);
        const state = buildState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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
