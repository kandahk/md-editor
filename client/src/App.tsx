import React, { useState, useMemo } from 'react';
import MDEditor from '@uiw/react-md-editor';
import './App.css';

interface FileItem {
  name: string;
  path: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState('');
  const [currentRepo, setCurrentRepo] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [unsavedFiles, setUnsavedFiles] = useState<Set<string>>(new Set());
  const [originalContent, setOriginalContent] = useState('');
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  const [uncommittedFiles, setUncommittedFiles] = useState<Set<string>>(new Set());
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const syncRepo = async () => {
    if (!repoUrl) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/repo/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, token })
      });
      
      const data = await response.json();
      if (data.success) {
        setCurrentRepo(data.repoPath);
        loadBranches(data.repoPath);
        loadFiles(data.repoPath);
      }
    } catch (error) {
      console.error('Sync failed:', error);
    }
    setLoading(false);
  };

  const loadBranches = async (repo: string) => {
    try {
      const response = await fetch(`${API_URL}/api/branches/${repo}`);
      const branchList = await response.json();
      setBranches(branchList);
    } catch (error) {
      console.error('Failed to load branches:', error);
    }
  };

  const switchBranch = async (branch: string) => {
    try {
      await fetch(`${API_URL}/api/branch/${currentRepo}/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch })
      });
      setCurrentBranch(branch);
      loadFiles(currentRepo);
      setCurrentFile('');
      setContent('');
    } catch (error) {
      console.error('Failed to switch branch:', error);
    }
  };

  const loadFiles = async (repo: string) => {
    try {
      const response = await fetch(`${API_URL}/api/files/${repo}`);
      const fileList = await response.json();
      setFiles(fileList);
      loadGitStatus(repo);
    } catch (error) {
      console.error('Failed to load files:', error);
    }
  };

  const loadGitStatus = async (repo: string) => {
    try {
      const response = await fetch(`${API_URL}/api/status/${repo}`);
      const modifiedFiles = await response.json();
      setUncommittedFiles(new Set(modifiedFiles));
    } catch (error) {
      console.error('Failed to load git status:', error);
    }
  };

  const loadFile = async (filePath: string) => {
    try {
      // Save current file content before switching
      if (currentFile && content !== originalContent) {
        setFileContents(prev => new Map(prev).set(currentFile, content));
      }
      
      // Check if we have unsaved content for this file
      const savedContent = fileContents.get(filePath);
      if (savedContent) {
        setContent(savedContent);
        const response = await fetch(`${API_URL}/api/file/${currentRepo}/${filePath}`);
        const data = await response.json();
        setOriginalContent(data.content);
      } else {
        const response = await fetch(`${API_URL}/api/file/${currentRepo}/${filePath}`);
        const data = await response.json();
        setContent(data.content);
        setOriginalContent(data.content);
      }
      
      setCurrentFile(filePath);
    } catch (error) {
      console.error('Failed to load file:', error);
    }
  };

  const saveFile = async () => {
    if (!currentFile) return;
    
    try {
      await fetch(`${API_URL}/api/file/${currentRepo}/${currentFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      setOriginalContent(content);
      setUnsavedFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(currentFile);
        return newSet;
      });
      setFileContents(prev => {
        const newMap = new Map(prev);
        newMap.delete(currentFile);
        return newMap;
      });
      loadGitStatus(currentRepo);
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  };

  const openCommitModal = () => {
    if (uncommittedFiles.size === 0) {
      alert('No changes to commit');
      return;
    }
    setShowCommitModal(true);
  };

  const commitChanges = async () => {
    if (!commitMessage.trim()) {
      alert('Please enter a commit message');
      return;
    }
    
    try {
      await fetch(`${API_URL}/api/repo/${currentRepo}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage, token, repoUrl })
      });
      setShowCommitModal(false);
      setCommitMessage('');
      loadGitStatus(currentRepo);
      alert('Changes committed and pushed!');
    } catch (error) {
      console.error('Failed to commit:', error);
    }
  };

  const buildFileTree = (filePaths: string[]): TreeNode[] => {
    const root: TreeNode[] = [];
    
    filePaths.forEach(filePath => {
      const parts = filePath.split('/');
      let currentLevel = root;
      
      parts.forEach((part, index) => {
        const isLastPart = index === parts.length - 1;
        const existingNode = currentLevel.find(node => node.name === part);
        
        if (existingNode) {
          if (!isLastPart && existingNode.children) {
            currentLevel = existingNode.children;
          }
        } else {
          const newNode: TreeNode = {
            name: part,
            path: parts.slice(0, index + 1).join('/'),
            isDirectory: !isLastPart,
            children: !isLastPart ? [] : undefined
          };
          currentLevel.push(newNode);
          if (!isLastPart && newNode.children) {
            currentLevel = newNode.children;
          }
        }
      });
    });
    
    return root;
  };

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const renderTreeNode = (node: TreeNode, level: number = 0): React.ReactNode => {
    if (node.isDirectory) {
      const isExpanded = expandedFolders.has(node.path);
      return (
        <div key={node.path}>
          <div 
            className="tree-folder"
            style={{ paddingLeft: `${level * 1}rem` }}
            onClick={() => toggleFolder(node.path)}
          >
            <span className="folder-icon">{isExpanded ? '📂' : '📁'}</span>
            <span className="folder-name">{node.name}</span>
          </div>
          {isExpanded && node.children && (
            <div className="tree-children">
              {node.children.map(child => renderTreeNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    } else {
      const isActive = node.path === currentFile;
      const isUnsaved = unsavedFiles.has(node.path);
      const isUncommitted = uncommittedFiles.has(node.path);
      
      return (
        <div
          key={node.path}
          className={`tree-file ${isActive ? 'active' : ''} ${isUnsaved ? 'unsaved' : ''} ${isUncommitted ? 'uncommitted' : ''}`}
          style={{ paddingLeft: `${level * 1}rem` }}
          onClick={() => loadFile(node.path)}
        >
          <span className="file-icon">📄</span>
          <span className="file-name">
            {node.name}
            {isUnsaved && ' ●'}
            {!isUnsaved && isUncommitted && ' ▲'}
          </span>
        </div>
      );
    }
  };

  return (
    <div className="App">
      <header className="header">
        <div className="header-left">
          <img src="/md-logo.png" alt="Markdown Editor" className="logo" />
          <h1 className="app-title">Markdown Editor</h1>
        </div>
        <div className="repo-controls">
          <input
            type="text"
            placeholder="Repository URL (GitHub/GitLab) "
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <input
            type="password"
            placeholder="Access Token (optional)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button onClick={syncRepo} disabled={loading}>
            {loading ? 'Syncing...' : 'Sync Repo'}
          </button>
        </div>
        
        {currentRepo && (
          <div className="file-controls">
            <select value={currentBranch} onChange={(e) => switchBranch(e.target.value)}>
              {branches.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
            <button onClick={saveFile} disabled={!currentFile}>Save</button>
          </div>
        )}
      </header>

      <div className="main-content">
        {currentRepo && (
          <div className="sidebar">
            <h3>Files</h3>
            <div className="file-tree">
              {fileTree.map(node => renderTreeNode(node))}
            </div>
            <div className="commit-controls">
              <button onClick={openCommitModal}>Commit & Push</button>
            </div>
          </div>
        )}

        <div className="editor-container">
          {currentFile ? (
            <MDEditor
              value={content}
              onChange={(val) => {
                const newContent = val || '';
                setContent(newContent);
                setFileContents(prev => new Map(prev).set(currentFile, newContent));
                if (newContent !== originalContent) {
                  setUnsavedFiles(prev => new Set(prev).add(currentFile));
                } else {
                  setUnsavedFiles(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(currentFile);
                    return newSet;
                  });
                }
              }}
              height={600}
              data-color-mode="light"
            />
          ) : (
            <div className="welcome">
              <h2>Markdown Editor</h2>
              <p>Sync a repository to start editing markdown files</p>
            </div>
          )}
        </div>
      </div>
      
      {showCommitModal && (
        <div className="modal-overlay">
          <div className="commit-modal">
            <h3>Commit Changes</h3>
            <div className="changed-files">
              <h4>Files to be committed:</h4>
              <ul>
                {Array.from(uncommittedFiles).map(file => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </div>
            <div className="commit-message">
              <label>Commit message:</label>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Enter commit message..."
                rows={3}
              />
            </div>
            <div className="modal-buttons">
              <button onClick={() => setShowCommitModal(false)}>Cancel</button>
              <button onClick={commitChanges} className="commit-btn">Commit & Push</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;