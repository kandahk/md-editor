const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');

const app = express();
const PORT = process.env.PORT || 5001;
    const git = simpleGit();
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

const REPOS_DIR = path.join(__dirname, 'repos');
fs.ensureDirSync(REPOS_DIR);

// Clone or pull repository
app.post('/api/repo/sync', async (req, res) => {
  try {
    const { repoUrl, token } = req.body;
    const repoName = repoUrl.split('/').pop().replace('.git', '');
    const repoPath = path.join(REPOS_DIR, repoName);
    
    if (!token) {
      return res.status(400).json({ error: 'Access token is required for private repositories' });
    }
    
    const authUrl = repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
    const git = simpleGit();
    
    if (await fs.pathExists(repoPath)) {
      await fs.remove(repoPath);
    }
    
    await git.clone(authUrl, repoPath);
    
    res.json({ success: true, repoPath: repoName });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get branches
app.get('/api/branches/:repo', async (req, res) => {
  try {
    const repoPath = path.join(REPOS_DIR, req.params.repo);
    const git = simpleGit(repoPath);
    const branches = await git.branch(['-r']);
    const branchList = branches.all.map(b => b.replace('origin/', '')).filter(b => b !== 'HEAD');
    res.json(branchList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get git status
app.get('/api/status/:repo', async (req, res) => {
  try {
    const repoPath = path.join(REPOS_DIR, req.params.repo);
    const git = simpleGit(repoPath);
    const status = await git.status();
    const modifiedFiles = [...status.modified, ...status.created, ...status.staged];
    res.json(modifiedFiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Switch branch
app.post('/api/branch/:repo/switch', async (req, res) => {
  try {
    const { branch } = req.body;
    const repoPath = path.join(REPOS_DIR, req.params.repo);
    const git = simpleGit(repoPath);
    await git.checkout(branch);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List markdown files
app.get('/api/files/:repo', async (req, res) => {
  try {
    const repoPath = path.join(REPOS_DIR, req.params.repo);
    const files = await getMarkdownFiles(repoPath);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read file content
app.get('/api/file/:repo/*', async (req, res) => {
  try {
    const filePath = path.join(REPOS_DIR, req.params.repo, req.params[0]);
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save file content
app.put('/api/file/:repo/*', async (req, res) => {
  try {
    const filePath = path.join(REPOS_DIR, req.params.repo, req.params[0]);
    await fs.writeFile(filePath, req.body.content);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Commit and push changes
app.post('/api/repo/:repo/commit', async (req, res) => {
  try {
    const { message, token, repoUrl } = req.body;
    const repoPath = path.join(REPOS_DIR, req.params.repo);
    const git = simpleGit(repoPath);
    
    const status = await git.status();
    if (status.files.length === 0) {
      return res.json({ success: true, message: 'No changes to commit' });
    }
    
    const authUrl = repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
    await git.addRemote('origin', authUrl).catch(() => {});
    
    await git.add('.');
    await git.commit(message || 'Update markdown files');
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    await git.push('origin', currentBranch);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Commit error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function getMarkdownFiles(dir, basePath = '') {
  const files = [];
  const items = await fs.readdir(dir);
  
  for (const item of items) {
    if (item.startsWith('.')) continue;
    
    const fullPath = path.join(dir, item);
    const relativePath = path.join(basePath, item);
    const stat = await fs.stat(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...await getMarkdownFiles(fullPath, relativePath));
    } else if (item.endsWith('.md')) {
      files.push(relativePath);
    }
  }
  
  return files;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});