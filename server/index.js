require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

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
    
    // Return detailed status with file types
    const fileStatus = [];
    
    // Modified files
    status.modified.forEach(file => fileStatus.push({ file, status: 'modified' }));
    
    // New files (both staged and untracked)
    status.created.forEach(file => fileStatus.push({ file, status: 'added' }));
    status.not_added.forEach(file => fileStatus.push({ file, status: 'added' }));
    
    // Deleted files
    status.deleted.forEach(file => fileStatus.push({ file, status: 'deleted' }));
    
    // Renamed files
    status.renamed.forEach(r => fileStatus.push({ file: r.to, status: 'renamed' }));
    
    // Files in staging area
    status.staged.forEach(file => {
      // Only add if not already in the list
      if (!fileStatus.find(f => f.file === file)) {
        fileStatus.push({ file, status: 'modified' });
      }
    });
    
    res.json(fileStatus);
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

// List markdown files and folders
app.get('/api/files/:repo', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const structure = await getFileStructure(repoPath);
    res.json(structure);
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

// Serve image files
app.get('/api/image/:repo/*', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const imagePath = req.params[0];
    const filePath = path.join(repoPath, imagePath);
    
    console.log('Image request:', {
      repo: req.params.repo,
      imagePath: imagePath,
      repoPath: repoPath,
      fullPath: filePath,
      exists: await fs.pathExists(filePath)
    });
    
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'Image not found', path: filePath });
    }
    
    // Ensure absolute path for sendFile
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    res.sendFile(absolutePath);
  } catch (error) {
    console.error('Image serve error:', error);
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

// Create new file
app.post('/api/file/:repo/*', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const filePath = path.join(repoPath, req.params[0]);
    
    // Check if file already exists
    if (await fs.pathExists(filePath)) {
      return res.status(400).json({ error: 'File already exists' });
    }
    
    // Ensure directory exists
    await fs.ensureDir(path.dirname(filePath));
    
    // Create file with initial content
    await fs.writeFile(filePath, req.body.content || '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file
app.delete('/api/file/:repo/*', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const filePath = path.join(repoPath, req.params[0]);
    
    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    await fs.remove(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete folder
app.delete('/api/folder/:repo/*', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const folderPath = path.join(repoPath, req.params[0]);
    
    // Check if folder exists
    if (!await fs.pathExists(folderPath)) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Check if it's actually a directory
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a folder' });
    }
    
    await fs.remove(folderPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create folder
app.post('/api/folder/:repo/*', async (req, res) => {
  try {
    const repoPath = await getUserRepoPath(req.params.repo);
    const folderPath = path.join(repoPath, req.params[0]);
    
    // Check if folder already exists
    if (await fs.pathExists(folderPath)) {
      return res.status(400).json({ error: 'Folder already exists' });
    }
    
    await fs.ensureDir(folderPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload image
app.post('/api/upload/:repo/*', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const repoPath = await getUserRepoPath(req.params.repo);
    const targetPath = path.join(repoPath, req.params[0], req.file.originalname);
    
    // Ensure directory exists
    await fs.ensureDir(path.dirname(targetPath));
    
    // Move file from temp location to target
    await fs.move(req.file.path, targetPath, { overwrite: false });
    
    res.json({ success: true, filename: req.file.originalname });
  } catch (error) {
    // Clean up temp file if it exists
    if (req.file && req.file.path) {
      await fs.remove(req.file.path).catch(() => {});
    }
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

async function getFileStructure(dir, basePath = '') {
  const items = [];
  const entries = await fs.readdir(dir);
  
  for (const item of entries) {
    if (item.startsWith('.')) continue;
    
    const fullPath = path.join(dir, item);
    const relativePath = path.join(basePath, item);
    const stat = await fs.stat(fullPath);
    
    if (stat.isDirectory()) {
      // Add folder
      items.push({
        path: relativePath,
        type: 'folder'
      });
      // Recursively get children
      items.push(...await getFileStructure(fullPath, relativePath));
    } else if (item.endsWith('.md') || item.match(/\.(png|jpg|jpeg|gif|svg)$/i)) {
      items.push({
        path: relativePath,
        type: 'file'
      });
    }
  }
  
  return items;
}

// Legacy function for backward compatibility
async function getMarkdownFiles(dir, basePath = '') {
  const structure = await getFileStructure(dir, basePath);
  return structure.filter(item => item.type === 'file').map(item => item.path);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});