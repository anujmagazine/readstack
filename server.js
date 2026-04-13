const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3847;
const DB_FILE = path.join(__dirname, 'readstack-data.json');

// --- JSON file store ---
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { items: [], nextId: 1 };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

// ============================================================
// PRIORITIZATION ENGINE — based on AI&Beyond's 3 pillars
// ============================================================
// Pillar 1: AI Literacy (enterprise AI education, understanding, training)
// Pillar 2: AI Adoption (implementing AI, tools, building, practical use)
// Pillar 3: AI ROI (business impact, productivity, cost, enterprise value)

const LITERACY_KEYWORDS = [
  'learn', 'certification', 'certified', 'course', 'training', 'tutorial',
  'guide', 'explain', 'understand', 'fundamentals', 'basics', 'education',
  'teach', 'skill', 'skills', 'prompting', 'prompt', 'literacy',
  'knowledge', 'second brain', 'research', 'paper', 'read', 'ted talk',
  'watch', 'study', 'demystif', 'capability', 'capabilities', 'what is',
  'how does', 'introduction', 'beginner', 'architect', 'foundations',
  'exam', 'slides', 'presentation', 'deck', 'masterclass', 'workshop',
  'bootcamp', 'upskill', 'reskill', 'curriculum', 'pedagogy',
  'karpathy', 'tiago forte', 'ethan mollick'
];

const ADOPTION_KEYWORDS = [
  'build', 'built', 'create', 'setup', 'install', 'configure', 'deploy',
  'implement', 'integrate', 'tool', 'tools', 'agent', 'agents', 'workflow',
  'automat', 'vibe coding', 'code', 'coding', 'github', 'repo',
  'clone', 'api', 'sdk', 'plugin', 'extension', 'chrome', 'app',
  'platform', 'framework', 'stack', 'architecture', 'pipeline',
  'enterprise', 'adoption', 'digital transform', 'use case', 'use cases',
  'implement', 'pilot', 'rollout', 'scale', 'operationalize',
  'chief of staff', 'copilot', 'assistant', 'ai agent', 'autoresearch',
  'gemma', 'claude', 'gpt', 'ollama', 'vosk', 'mediapipe',
  'lovable', 'cursor', 'replit', 'v0'
];

const ROI_KEYWORDS = [
  'roi', 'revenue', 'cost', 'productiv', 'efficien', 'business',
  'company', 'startup', 'founder', 'ceo', 'enterprise', 'value',
  'impact', 'result', 'outcome', 'metric', 'measure', 'kpi',
  'one person', 'one machine', 'solo', 'leverage', 'scale',
  'million', 'billion', 'growth', 'profit', 'saving', 'reduce',
  'transform', 'disruption', 'innovation', 'competitive',
  'investment', 'strategy', 'strategic', 'market', 'industry',
  'job', 'career', 'replace', 'augment', 'workforce',
  'aravind srinivas', 'jack dorsey', 'economist'
];

const EXPERIMENT_KEYWORDS = [
  'build', 'try', 'install', 'setup', 'configure', 'create',
  'clone', 'repo', 'github', 'deploy', 'run', 'test',
  'experiment', 'prototype', 'poc', 'hack', 'tinker',
  'vibe coding', 'code', 'app', 'tool', 'agent', 'pipeline',
  'architecture', 'api', 'sdk', 'plugin', 'extension',
  'autoresearch', 'ollama', 'vosk', 'mediapipe', 'chrome',
  'week 1', 'how i built', 'how to build', 'step by step',
  'lennyrpg', 'lovable'
];

const CONTENT_KEYWORDS = [
  'linkedin', 'post', 'content', 'article', 'blog', 'write',
  'publish', 'share', 'insight', 'opinion', 'take', 'perspective',
  'news', 'announce', 'launch', 'release', 'update', 'trend',
  'prediction', 'forecast', 'analysis', 'commentary', 'thread',
  'speak', 'talk', 'present', 'deck', 'slide', 'narrative',
  'story', 'case study', 'example', 'showcase', 'economist',
  'interesting', 'decode'
];

function scoreKeywords(text, keywords) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score++;
  }
  return score;
}

function analyzeItem(item) {
  const text = `${item.title || ''} ${item.url || ''} ${item.notes || ''} ${item.raw_text || ''}`;

  const literacy = scoreKeywords(text, LITERACY_KEYWORDS);
  const adoption = scoreKeywords(text, ADOPTION_KEYWORDS);
  const roi = scoreKeywords(text, ROI_KEYWORDS);

  // Priority score: weighted sum (each pillar hit adds to relevance)
  // Items touching multiple pillars are most valuable
  const pillarsHit = (literacy > 0 ? 1 : 0) + (adoption > 0 ? 1 : 0) + (roi > 0 ? 1 : 0);
  const rawScore = literacy + adoption + roi;
  // Bonus for multi-pillar relevance
  const priorityScore = rawScore + (pillarsHit * 3);

  const experimentScore = scoreKeywords(text, EXPERIMENT_KEYWORDS);
  const contentScore = scoreKeywords(text, CONTENT_KEYWORDS);

  return {
    priority_score: priorityScore,
    pillars: {
      literacy,
      adoption,
      roi
    },
    pillars_hit: pillarsHit,
    is_experiment: experimentScore >= 2,
    experiment_score: experimentScore,
    is_content: contentScore >= 2,
    content_score: contentScore
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---

// List items with analysis
app.get('/api/items', (req, res) => {
  const { status = 'pending' } = req.query;
  const db = loadDB();
  let result = db.items.filter(i => i.status === status);

  // Attach analysis to each item
  result = result.map(item => ({
    ...item,
    analysis: analyzeItem(item)
  }));

  res.json(result);
});

// Prioritized list
app.get('/api/items/prioritized', (req, res) => {
  const db = loadDB();
  let result = db.items
    .filter(i => i.status === 'pending')
    .map(item => ({ ...item, analysis: analyzeItem(item) }))
    .filter(item => item.analysis.priority_score > 0)
    .sort((a, b) => b.analysis.priority_score - a.analysis.priority_score);

  res.json(result);
});

// Experiment candidates
app.get('/api/items/experiments', (req, res) => {
  const db = loadDB();
  let result = db.items
    .filter(i => i.status === 'pending')
    .map(item => ({ ...item, analysis: analyzeItem(item) }))
    .filter(item => item.analysis.is_experiment)
    .sort((a, b) => b.analysis.experiment_score - a.analysis.experiment_score);

  res.json(result);
});

// Content candidates
app.get('/api/items/content', (req, res) => {
  const db = loadDB();
  let result = db.items
    .filter(i => i.status === 'pending')
    .map(item => ({ ...item, analysis: analyzeItem(item) }))
    .filter(item => item.analysis.is_content)
    .sort((a, b) => b.analysis.content_score - a.analysis.content_score);

  res.json(result);
});

// Done list
app.get('/api/items/done', (req, res) => {
  const db = loadDB();
  let result = db.items
    .filter(i => i.status === 'done')
    .map(item => ({ ...item, analysis: analyzeItem(item) }))
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));

  res.json(result);
});

// Stats
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const pending = db.items.filter(i => i.status === 'pending');
  const done = db.items.filter(i => i.status === 'done');
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const completedThisWeek = done.filter(i => i.completed_at && i.completed_at >= weekAgo).length;

  // Count experiments and content
  const experiments = pending.filter(i => analyzeItem(i).is_experiment).length;
  const content = pending.filter(i => analyzeItem(i).is_content).length;
  const prioritized = pending.filter(i => analyzeItem(i).priority_score > 0).length;

  res.json({
    pending: pending.length,
    completed: done.length,
    completedThisWeek,
    experiments,
    content,
    prioritized
  });
});

// Add item
app.post('/api/items', (req, res) => {
  const db = loadDB();
  const { raw } = req.body;

  const parsed = parseRawEntry(raw || '');
  const item = {
    id: db.nextId++,
    title: parsed.title,
    url: parsed.url,
    notes: parsed.notes,
    raw_text: raw || '',
    status: 'pending',
    created_at: now(),
    completed_at: null
  };

  db.items.push(item);
  saveDB(db);
  res.json({ ...item, analysis: analyzeItem(item) });
});

// Batch import
app.post('/api/items/batch', (req, res) => {
  const db = loadDB();
  const { text } = req.body;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l !== '-');
  let count = 0;

  for (const line of lines) {
    const parsed = parseRawEntry(line);
    db.items.push({
      id: db.nextId++,
      title: parsed.title,
      url: parsed.url,
      notes: parsed.notes,
      raw_text: line,
      status: 'pending',
      created_at: now(),
      completed_at: null
    });
    count++;
  }

  saveDB(db);
  res.json({ imported: count });
});

// Update item status
app.patch('/api/items/:id', (req, res) => {
  const db = loadDB();
  const id = parseInt(req.params.id);
  const item = db.items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const allowed = ['title', 'url', 'notes', 'status'];
  for (const [key, val] of Object.entries(req.body)) {
    if (allowed.includes(key)) item[key] = val;
  }
  if (req.body.status === 'done') item.completed_at = now();
  if (req.body.status === 'pending') item.completed_at = null;

  saveDB(db);
  res.json({ ...item, analysis: analyzeItem(item) });
});

// Delete item
app.delete('/api/items/:id', (req, res) => {
  const db = loadDB();
  db.items = db.items.filter(i => i.id !== parseInt(req.params.id));
  saveDB(db);
  res.json({ ok: true });
});

// --- Parse raw notepad entry ---
function parseRawEntry(raw) {
  let text = raw.replace(/^[-•*]\s*/, '').trim();

  // Strip category prefix (we don't store category — analysis engine handles it)
  const catMatch = text.match(/^(CONTENT|LEARN|BUILD|WATCH|TRY|READ)\s*[-–—:]\s*/i);
  if (catMatch) {
    text = text.slice(catMatch[0].length).trim();
  }

  // Also strip secondary prefix like "linkedin post" or "linkedin"
  const secondaryMatch = text.match(/^linkedin\s*(post)?\s*[-–—:]?\s*/i);
  if (secondaryMatch) {
    text = text.slice(secondaryMatch[0].length).trim();
  }

  const urlRegex = /https?:\/\/[^\s)]+/g;
  const urls = text.match(urlRegex) || [];
  const url = urls[0] || null;

  let title = text.replace(urlRegex, '').replace(/\s+/g, ' ').trim();
  if (!title && url) {
    try { title = new URL(url).hostname.replace('www.', ''); }
    catch { title = url.slice(0, 80); }
  }

  const notes = urls.length > 1 ? urls.slice(1).join('\n') : null;
  return { title, url, notes };
}

// --- Start ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`\n  ReadStack is running!\n`);
  console.log(`  Laptop:  http://localhost:${PORT}`);
  console.log(`  Phone:   http://${ip}:${PORT}`);
  console.log(`\n  Open the phone URL on your mobile browser and "Add to Home Screen" to install.\n`);
});
