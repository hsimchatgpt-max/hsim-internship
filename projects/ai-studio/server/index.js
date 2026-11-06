import path from 'node:path';
import express from 'express';
import { PORT, ROOT, geminiKey } from './config.js';
import { buildRouter } from './routes.js';

const app = express();
app.disable('x-powered-by');
app.use('/api', buildRouter());
app.use(express.static(path.join(ROOT, 'web')));
app.use((e, q, s, n) => s.status(500).json({ error: String(e.message || e).replace(/AIza\S+|AQ\.\S+/g, '[redacted]') }));

// Local single-user tool: bind to loopback only (there is no login). Set HOST=0.0.0.0 only behind your own auth.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`AI Studio on http://${HOST}:${PORT}  (Gemini key ${geminiKey() ? 'configured' : 'MISSING — set GEMINI_API_KEY in .env'})`);
});
