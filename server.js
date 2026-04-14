const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');

const app = express();
const PORT = 3847;
const DB_FILE = path.join(__dirname, 'readstack-data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OLLAMA_URL = 'http://localhost:11434';
// Try models in order of preference — falls back if one needs too much memory
const MODELS = ['gemma4:latest', 'gemma3:4b', 'gemma3:2b'];
let activeModel = null; // auto-detected on first use

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- File upload config ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${req.params.id}-${Date.now()}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

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
// GEMMA 4 INTEGRATION via Ollama
// ============================================================

async function fetchWebpageText(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();

    // Extract <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : null;

    // Extract og:title and og:description
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : null;

    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
    const ogDesc = ogDescMatch ? ogDescMatch[1].trim() : null;

    // Extract main text content (strip HTML tags, scripts, styles)
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate to ~3000 chars to keep token usage reasonable
    if (text.length > 3000) text = text.slice(0, 3000) + '...';

    return {
      pageTitle: ogTitle || pageTitle,
      ogDesc,
      bodyText: text,
      fetched: true
    };
  } catch (err) {
    console.log(`  [fetch] Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

async function detectModel() {
  if (activeModel) return activeModel;

  // Check which models are available
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json();
    const available = data.models.map(m => m.name);
    console.log(`  [ollama] Available models: ${available.join(', ')}`);

    for (const model of MODELS) {
      if (available.includes(model)) {
        // Try a quick test to see if it actually loads
        try {
          const test = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: 'hi', stream: false, options: { num_predict: 5 } })
          });
          const testData = await test.json();
          if (testData.error) {
            console.log(`  [ollama] ${model} error: ${testData.error}`);
            continue;
          }
          activeModel = model;
          console.log(`  [ollama] Using model: ${model}`);
          return model;
        } catch (e) {
          console.log(`  [ollama] ${model} test failed: ${e.message}`);
          continue;
        }
      }
    }
    console.log(`  [ollama] No suitable model found`);
    return null;
  } catch (err) {
    console.log(`  [ollama] Cannot connect: ${err.message}`);
    return null;
  }
}

async function askGemma(prompt) {
  const model = await detectModel();
  if (!model) return null;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 200
        }
      })
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = await res.json();
    if (data.error) {
      // Model might have run out of memory — try resetting activeModel
      console.log(`  [ollama] ${model} error: ${data.error}`);
      activeModel = null;
      return null;
    }
    return data.response?.trim() || null;
  } catch (err) {
    console.log(`  [ollama] Error: ${err.message}`);
    activeModel = null;
    return null;
  }
}

async function summarizeItem(item) {
  const url = item.url;
  const rawText = item.raw_text || '';

  let webpage = null;
  let approach = 'none';

  // --- Approach B: Fetch webpage and summarize ---
  if (url) {
    webpage = await fetchWebpageText(url);
  }

  let prompt;
  if (webpage && webpage.bodyText && webpage.bodyText.length > 100) {
    // Approach B — full content available
    approach = 'full';
    prompt = `You are a concise article summarizer. Given the following webpage content, do two things:

1. TITLE: Extract or generate a clear, descriptive title (max 15 words).
2. SUMMARY: Write exactly 2-3 sentences summarizing the key point of this article/page. Focus on what the reader will learn or gain.

Webpage title: ${webpage.pageTitle || 'Unknown'}
${webpage.ogDesc ? `Description: ${webpage.ogDesc}` : ''}
Content: ${webpage.bodyText}

User's note about this: ${rawText}

Respond in EXACTLY this format (no markdown, no extra text):
TITLE: <the title>
SUMMARY: <2-3 sentence summary>`;
  } else {
    // Approach A — URL-only fallback
    approach = 'url-only';
    const domain = url ? (() => { try { return new URL(url).hostname; } catch { return ''; } })() : '';
    prompt = `You are a concise article summarizer. Based on the URL and the user's note, infer what this article/resource is likely about and do two things:

1. TITLE: Generate a clear, descriptive title (max 15 words).
2. SUMMARY: Write exactly 2-3 sentences describing what this resource likely covers and why it might be valuable to read.

URL: ${url || 'No URL'}
Domain: ${domain}
User's note: ${rawText}
${webpage?.pageTitle ? `Page title: ${webpage.pageTitle}` : ''}
${webpage?.ogDesc ? `Page description: ${webpage.ogDesc}` : ''}

Respond in EXACTLY this format (no markdown, no extra text):
TITLE: <the title>
SUMMARY: <2-3 sentence summary>`;
  }

  console.log(`  [gemma4] Summarizing item ${item.id} (${approach})...`);
  const response = await askGemma(prompt);

  if (!response) return { title: null, summary: null, approach };

  // Parse response
  const titleMatch = response.match(/TITLE:\s*(.+?)(?:\n|SUMMARY:)/s);
  const summaryMatch = response.match(/SUMMARY:\s*(.+)/s);

  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    summary: summaryMatch ? summaryMatch[1].trim() : response,
    approach
  };
}

// ============================================================
// PRIORITIZATION ENGINE — based on AI&Beyond's 3 pillars
// ============================================================

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
  // Include summary in analysis text for better prioritization
  const text = `${item.title || ''} ${item.url || ''} ${item.notes || ''} ${item.raw_text || ''} ${item.ai_summary || ''} ${item.ai_title || ''}`;

  const literacy = scoreKeywords(text, LITERACY_KEYWORDS);
  const adoption = scoreKeywords(text, ADOPTION_KEYWORDS);
  const roi = scoreKeywords(text, ROI_KEYWORDS);

  const pillarsHit = (literacy > 0 ? 1 : 0) + (adoption > 0 ? 1 : 0) + (roi > 0 ? 1 : 0);
  const rawScore = literacy + adoption + roi;
  const priorityScore = rawScore + (pillarsHit * 3);

  const experimentScore = scoreKeywords(text, EXPERIMENT_KEYWORDS);
  const contentScore = scoreKeywords(text, CONTENT_KEYWORDS);

  return {
    priority_score: priorityScore,
    pillars: { literacy, adoption, roi },
    pillars_hit: pillarsHit,
    is_experiment: experimentScore >= 2,
    experiment_score: experimentScore,
    is_content: contentScore >= 2,
    content_score: contentScore
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// --- API Routes ---

// List items with analysis
app.get('/api/items', (req, res) => {
  const { status = 'pending' } = req.query;
  const db = loadDB();
  let result = db.items.filter(i => i.status === status);
  result = result.map(item => ({ ...item, analysis: analyzeItem(item) }));
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
  const experiments = pending.filter(i => analyzeItem(i).is_experiment).length;
  const content = pending.filter(i => analyzeItem(i).is_content).length;
  const prioritized = pending.filter(i => analyzeItem(i).priority_score > 0).length;

  res.json({ pending: pending.length, completed: done.length, completedThisWeek, experiments, content, prioritized });
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
    completed_at: null,
    // AI fields
    ai_title: null,
    ai_summary: null,
    ai_approach: null,
    ai_status: 'pending', // pending | processing | done | failed
    // Attachments
    attachments: []
  };

  db.items.push(item);
  saveDB(db);

  // Trigger async summarization
  triggerSummarize(item.id);

  res.json({ ...item, analysis: analyzeItem(item) });
});

// Batch import
app.post('/api/items/batch', (req, res) => {
  const db = loadDB();
  const { text } = req.body;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l !== '-');
  const ids = [];

  for (const line of lines) {
    const parsed = parseRawEntry(line);
    const item = {
      id: db.nextId++,
      title: parsed.title,
      url: parsed.url,
      notes: parsed.notes,
      raw_text: line,
      status: 'pending',
      created_at: now(),
      completed_at: null,
      ai_title: null,
      ai_summary: null,
      ai_approach: null,
      ai_status: 'pending',
      attachments: []
    };
    db.items.push(item);
    ids.push(item.id);
  }

  saveDB(db);

  // Trigger batch summarization in background (sequential to not overload Ollama)
  triggerBatchSummarize(ids);

  res.json({ imported: ids.length });
});

// Update item
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
  const id = parseInt(req.params.id);
  // Also delete associated uploads
  const item = db.items.find(i => i.id === id);
  if (item && item.attachments) {
    for (const att of item.attachments) {
      const fp = path.join(UPLOADS_DIR, att.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  }
  db.items = db.items.filter(i => i.id !== id);
  saveDB(db);
  res.json({ ok: true });
});

// --- Summarize single item (manual trigger / retry) ---
app.post('/api/items/:id/summarize', async (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const item = db.items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  item.ai_status = 'processing';
  saveDB(db);

  try {
    const result = await summarizeItem(item);
    const db2 = loadDB();
    const item2 = db2.items.find(i => i.id === id);
    if (item2) {
      item2.ai_title = result.title;
      item2.ai_summary = result.summary;
      item2.ai_approach = result.approach;
      item2.ai_status = result.summary ? 'done' : 'failed';
      saveDB(db2);
    }
    res.json({ ...item2, analysis: analyzeItem(item2) });
  } catch (err) {
    const db2 = loadDB();
    const item2 = db2.items.find(i => i.id === id);
    if (item2) { item2.ai_status = 'failed'; saveDB(db2); }
    res.status(500).json({ error: err.message });
  }
});

// --- Summarize ALL pending items ---
app.post('/api/summarize-all', (req, res) => {
  const db = loadDB();
  const pendingIds = db.items
    .filter(i => i.ai_status === 'pending' || i.ai_status === 'failed')
    .map(i => i.id);

  if (pendingIds.length === 0) return res.json({ message: 'Nothing to summarize', count: 0 });

  triggerBatchSummarize(pendingIds);
  res.json({ message: `Summarizing ${pendingIds.length} items in background`, count: pendingIds.length });
});

// --- Upload attachment ---
app.post('/api/items/:id/attachments', upload.single('file'), (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const item = db.items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  if (!item.attachments) item.attachments = [];
  const attachment = {
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype,
    uploaded_at: now()
  };
  item.attachments.push(attachment);
  saveDB(db);

  res.json(attachment);
});

// --- Delete attachment ---
app.delete('/api/items/:id/attachments/:filename', (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const item = db.items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const filename = req.params.filename;
  item.attachments = (item.attachments || []).filter(a => a.filename !== filename);
  const fp = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  saveDB(db);
  res.json({ ok: true });
});

// --- AI status for polling ---
app.get('/api/ai-status', (req, res) => {
  const db = loadDB();
  const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
  db.items.forEach(i => {
    const s = i.ai_status || 'pending';
    counts[s] = (counts[s] || 0) + 1;
  });
  res.json(counts);
});

// --- Background summarization ---
function triggerSummarize(id) {
  setImmediate(async () => {
    try {
      const db = loadDB();
      const item = db.items.find(i => i.id === id);
      if (!item) return;
      item.ai_status = 'processing';
      saveDB(db);

      const result = await summarizeItem(item);
      const db2 = loadDB();
      const item2 = db2.items.find(i => i.id === id);
      if (item2) {
        item2.ai_title = result.title;
        item2.ai_summary = result.summary;
        item2.ai_approach = result.approach;
        item2.ai_status = result.summary ? 'done' : 'failed';
        saveDB(db2);
        console.log(`  [gemma4] Item ${id} summarized (${result.approach})`);
      }
    } catch (err) {
      console.log(`  [gemma4] Failed item ${id}: ${err.message}`);
      const db2 = loadDB();
      const item2 = db2.items.find(i => i.id === id);
      if (item2) { item2.ai_status = 'failed'; saveDB(db2); }
    }
  });
}

function triggerBatchSummarize(ids) {
  setImmediate(async () => {
    console.log(`  [gemma4] Batch summarizing ${ids.length} items...`);
    for (const id of ids) {
      try {
        const db = loadDB();
        const item = db.items.find(i => i.id === id);
        if (!item || item.ai_status === 'done') continue;

        item.ai_status = 'processing';
        saveDB(db);

        const result = await summarizeItem(item);
        const db2 = loadDB();
        const item2 = db2.items.find(i => i.id === id);
        if (item2) {
          item2.ai_title = result.title;
          item2.ai_summary = result.summary;
          item2.ai_approach = result.approach;
          item2.ai_status = result.summary ? 'done' : 'failed';
          saveDB(db2);
          console.log(`  [gemma4] Item ${id} done (${result.approach})`);
        }
      } catch (err) {
        console.log(`  [gemma4] Failed item ${id}: ${err.message}`);
        const db2 = loadDB();
        const item2 = db2.items.find(i => i.id === id);
        if (item2) { item2.ai_status = 'failed'; saveDB(db2); }
      }
    }
    console.log(`  [gemma4] Batch complete.`);
  });
}

// --- Parse raw notepad entry ---
function parseRawEntry(raw) {
  let text = raw.replace(/^[-•*]\s*/, '').trim();
  const catMatch = text.match(/^(CONTENT|LEARN|BUILD|WATCH|TRY|READ)\s*[-–—:]\s*/i);
  if (catMatch) text = text.slice(catMatch[0].length).trim();
  const secondaryMatch = text.match(/^linkedin\s*(post)?\s*[-–—:]?\s*/i);
  if (secondaryMatch) text = text.slice(secondaryMatch[0].length).trim();

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
  console.log(`  Gemma 4: ${OLLAMA_URL} (auto-summarize on add)\n`);
});
