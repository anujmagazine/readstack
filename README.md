# ReadStack 📚

A personal AI reading backlog manager that runs **100% locally** on your laptop — no cloud, no subscriptions, no data leaving your machine. Built for knowledge workers drowning in browser tabs and saved articles.

Access it from your phone on the same WiFi. Powered by local Gemma AI via Ollama.

![ReadStack Dashboard](https://img.shields.io/badge/status-active-brightgreen) ![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

### 🎯 Smart Prioritization
- Auto-scores every article against **3 pillars**: AI Literacy, AI Adoption, AI ROI
- Separate tabs for **Experiments** and **Content Ideas**
- Keyword-based categorization with multi-label tagging

### 🤖 Local AI Summarization (Gemma via Ollama)
- Fetches full webpage HTML and extracts text for accurate summaries
- Falls back to URL-inference when paywalled or blocked (X.com, LinkedIn)
- Smart model selection based on available RAM:
  - `gemma4:latest` → requires 7 GB+ free
  - `gemma3:4b` → requires 3.5 GB+ free
  - `gemma3:2b` → fallback for low-memory systems
- Background async summarization with live status polling

### 📊 Gamified Dashboard
- Backlog count with urgency alerts
- Weekly reading goal progress bar (target: 5/week)
- 7-day reading streak visualization
- Oldest item age & average backlog age
- Top Priority item card with one-click "Open & Read"
- Category breakdown: Literacy / Adoption / ROI / Content / Experiments

### 📎 File Attachments
- Attach **PDFs, Markdown files, screenshots, and images** to any article
- **Ctrl+V to paste screenshots** directly — clipboard paste handler opens attach modal
- Associate attachments with a URL (creates new item if needed)
- 20 MB file size limit, stored locally in `uploads/`

### 📱 Mobile-Friendly PWA
- Installable as a home screen app on iPhone/Android
- Works over local WiFi — access from phone without any cloud setup
- Dark theme optimized for phone reading

### ⚡ Frictionless Entry
- Paste any URL or raw text and hit **+**
- Bulk import: paste multiple lines at once
- Auto-detects titles, URLs, and free-text notes

---

## 🗂️ Tabs

| Tab | Description |
|-----|-------------|
| **Dashboard** | Gamified overview with streak, goals, and urgency nudges |
| **All** | Every pending item, newest first |
| **Prioritized** | Scored by AI relevance to your 3 pillars |
| **Experiments** | Things to try or test |
| **Content Ideas** | Articles that could spark LinkedIn posts / talks |
| **Done** | Completed reading archive |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Ollama](https://ollama.com/) installed and running locally
- At least one Gemma model pulled:

```bash
ollama pull gemma3:4b       # recommended (3.5 GB RAM)
ollama pull gemma3:2b       # low-memory machines
ollama pull gemma4:latest   # if you have 8+ GB free RAM
```

### Installation

```bash
git clone https://github.com/anujmagazine/readstack.git
cd readstack
npm install
node server.js
```

Open **http://localhost:3847** in your browser.

### Access from Phone (same WiFi)

1. Find your laptop's local IP — Windows: run `ipconfig` and look for IPv4 Address (e.g. `192.168.1.5`)
2. On your phone browser, go to: `http://192.168.1.5:3847`
3. Tap **Share → Add to Home Screen** to install as a PWA

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Storage | JSON flat file (`readstack-data.json`) |
| AI | Ollama (local) — Gemma 3/4 models |
| File uploads | Multer |
| Frontend | Vanilla JS + CSS (no framework) |
| PWA | Service Worker + Web App Manifest |

---

## 📁 Project Structure

```
readstack/
├── server.js              # Express backend, Ollama integration, API routes
├── package.json
├── public/
│   ├── index.html         # Full single-page app (UI + JS)
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service worker
├── uploads/               # File attachments (gitignored)
└── readstack-data.json    # Your reading data (gitignored)
```

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/items` | All items |
| `POST` | `/api/items` | Add item `{ raw: "url or text" }` |
| `PATCH` | `/api/items/:id` | Update status, title, notes |
| `DELETE` | `/api/items/:id` | Delete item |
| `GET` | `/api/items/prioritized` | Scored and ranked items |
| `GET` | `/api/items/experiments` | Experiment-tagged items |
| `GET` | `/api/items/content` | Content idea items |
| `GET` | `/api/items/done` | Completed items |
| `GET` | `/api/stats` | Counts for header and dashboard |
| `GET` | `/api/ai-status` | Ollama availability check |
| `POST` | `/api/items/:id/summarize` | Trigger AI summary for item |
| `POST` | `/api/summarize-all` | Batch summarize all pending |
| `POST` | `/api/items/:id/attachments` | Upload file attachment |
| `DELETE` | `/api/items/:id/attachments/:filename` | Remove attachment |

---

## ⚙️ Configuration

Default port is `3847`. To change, edit `server.js`:

```js
const PORT = 3847;
```

Ollama endpoint (default `http://localhost:11434`):

```js
const OLLAMA_BASE = 'http://localhost:11434';
```

---

## 🔒 Privacy

- **All data stays on your machine.** Nothing is sent to any external server.
- Ollama runs the LLM locally — no API keys, no usage costs.
- `readstack-data.json` and `uploads/` are gitignored by default.

---

## 🛣️ Roadmap

- [ ] Search and filter within tabs
- [ ] Export to Obsidian / Notion
- [ ] Reading time estimates
- [ ] Tag editor UI
- [ ] Dark/light theme toggle

---

## 📄 License

MIT — do whatever you want with it.

---

*Built with [Claude Code](https://claude.ai/claude-code)*
