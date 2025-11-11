require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');

const app = express();
const PORT = process.env.PORT || 5001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const DEFAULT_COMMIT_MESSAGE = process.env.DEFAULT_COMMIT_MESSAGE || 'Update markdown files';

app.use(cors({
  origin: CLIENT_URL,
  credentials: true
}));
app.use(express.json());

// Get repos directory from .env or use default
const REPOS_BASE_DIR = process.env.REPOS_BASE_DIR || path.join(__dirname, 'repos');
const REPOS_DIR = path.isAbsolute(REPOS_BASE_DIR) 
  ? REPOS_BASE_DIR 
  : path.join(__dirname, '..', REPOS_BASE_DIR);

fs.ensureDirSync(REPOS_DIR);
console.log(`Repositories will be stored in: ${REPOS_DIR}`);

// Helper function to get git username
async function getGitUsername() {
  try {
    const git = simpleGit();
    const username = await git.raw(['config', 'user.name']);
    return username.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
  } catch (error) {
    console.error('Failed to get git username:', error);
    return 'default_user';
  }
}

// Helper function to get user-specific repo path
async function getUserRepoPath(repoName) {
  const username = await getGitUsername();
  const userDir = path.join(REPOS_DIR, username);
  fs.ensureDirSync(userDir);
  return path.join(userDir, repoName);
}

// Helper function to create authenticated URL
function createAuthUrl(repoUrl, token, provider = 'github') {
  if (provider === 'gitlab') {
    // GitLab uses oauth2 token format
    return repoUrl.replace('https://gitlab.com/', `https://oauth2:${token}@gitlab.com/`);
  } else {
    // GitHub uses token directly
    return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
  }
}

// Clone or pull repository
app.post('/api/repo/sync', async (req, res) => {
  try {
    const { repoUrl, token, provider = 'github' } = req.body;
    const repoName = repoUrl.split('/').pop().replace('.git', '');
    const repoPath = await getUserRepoPath(repoName);
    
    if (!token) {
      return res.status(400).json({ error: 'Access token is required for private repositories' });
    }
    
    const authUrl = createAuthUrl(repoUrl, token, provider);
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
    const repoPath = await getUserRepoPath(req.params.repo);
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
    const repoPath = await getUserRepoPath(req.params.repo);
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
    const repoPath = await getUserRepoPath(req.params.repo);
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
    const repoPath = await getUserRepoPath(req.params.repo);
    const files = await getMarkdownFiles(repoPath);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read file content
app.get('/api/file/:repo/*', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const filePath = path.join(repoPath, req.params[0]);
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save file content
app.put('/api/file/:repo/*', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const filePath = path.join(repoPath, req.params[0]);
    await fs.writeFile(filePath, req.body.content);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Commit and push changes
app.post('/api/repo/:repo/commit', async (req, res) => {
  try {
    const { message, token, repoUrl, provider = 'github' } = req.body;
    const repoPath = await getUserRepoPath(req.params.repo);
    const git = simpleGit(repoPath);
    
    const status = await git.status();
    if (status.files.length === 0) {
      return res.json({ success: true, message: 'No changes to commit' });
    }
    
    const authUrl = createAuthUrl(repoUrl, token, provider);
    await git.addRemote('origin', authUrl).catch(() => {});
    
    // Get current branch
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    
    // Stage and commit local changes first
    await git.add('.');
    await git.commit(message || DEFAULT_COMMIT_MESSAGE);
    
    // Pull with rebase to integrate remote changes
    try {
      await git.pull('origin', currentBranch, {'--rebase': 'true'});
    } catch (pullError) {
      console.log('Pull warning (might be first push or no remote changes):', pullError.message);
    }
    
    // Push to remote
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