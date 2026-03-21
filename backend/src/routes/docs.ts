import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { staffMiddleware } from '../middleware/admin';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const PUBLIC_DOCS = ['campaign.md', 'replay-system.md', 'bot-ai-guide.md', 'enemy-ai-guide.md'];
const STAFF_DOCS = [
  'admin-and-systems.md',
  'infrastructure.md',
  'testing.md',
  'performance-and-internals.md',
  'bot-ai-internals.md',
  'openapi.yaml',
];

function resolveDocPath(filename: string): string {
  return path.join(process.cwd(), 'docs', path.basename(filename));
}

// Staff-only docs — admin + moderator (must be registered before the generic :filename route)
router.get('/docs/admin/:filename', authMiddleware, staffMiddleware, async (req, res) => {
  const filename = req.params.filename;
  if (!STAFF_DOCS.includes(filename)) {
    res.status(400).json({ error: 'Invalid document name' });
    return;
  }

  const filePath = resolveDocPath(filename);
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: 'Document not found' });
  }
});

// Public docs — any authenticated user
router.get('/docs/:filename', authMiddleware, async (req, res) => {
  const filename = req.params.filename;
  if (!PUBLIC_DOCS.includes(filename)) {
    res.status(400).json({ error: 'Invalid document name' });
    return;
  }

  const filePath = resolveDocPath(filename);
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: 'Document not found' });
  }
});

export default router;
