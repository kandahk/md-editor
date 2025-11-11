import React, { useState, useMemo, useEffect } from 'react';
import MDEditor from '@uiw/react-md-editor';
import mermaid from 'mermaid';
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
  const [gitProvider, setGitProvider] = useState<'github' | 'gitlab'>('github');
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmCallback, setConfirmCallback] = useState<(() => void) | null>(null);

  // Initialize Mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
    });
  }, []);

  // Re-render Mermaid diagrams when content changes
  useEffect(() => {
    const renderMermaid = async () => {
      const mermaidElements = document.querySelectorAll('code.mermaid:not([data-processed])');
      
      for (let i = 0; i < mermaidElements.length; i++) {
        const element = mermaidElements[i] as HTMLElement;
        const code = element.textContent?.trim() || '';
        
        if (code && code.length > 0) {
          element.setAttribute('data-processed', 'true');
          const id = `mermaid-diagram-${Date.now()}-${i}`;
          
          try {
            const { svg } = await mermaid.render(id, code);
            // Instead of replacing, just update innerHTML
            element.innerHTML = svg;
            element.style.display = 'block';
            element.style.textAlign = 'center';
          } catch (error) {
            console.error('Mermaid rendering error:', error);
            element.textContent = `Error rendering diagram: ${error}`;
          }
        }
      }
    };

    if (content) {
      setTimeout(renderMermaid, 300);
    }
  }, [content]);

  const syncRepo = async () => {
    if (!repoUrl) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/repo/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, token, provider: gitProvider })
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
      
      // Initialize edit history
      const initialContent = savedContent || (await fetch(`${API_URL}/api/file/${currentRepo}/${filePath}`).then(r => r.json())).content;
      setEditHistory([initialContent]);
      setHistoryIndex(0);
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
      setEditHistory([]);
      setHistoryIndex(-1);
      loadGitStatus(currentRepo);
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setContent(editHistory[newIndex]);
    }
  };

  const revertChanges = () => {
    showConfirm('Are you sure you want to revert all unsaved changes?', () => {
      setContent(originalContent);
      setFileContents(prev => {
        const newMap = new Map(prev);
        newMap.delete(currentFile);
        return newMap;
      });
      setUnsavedFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(currentFile);
        return newSet;
      });
      setEditHistory([originalContent]);
      setHistoryIndex(0);
    });
  };

  const showAlert = (message: string) => {
    setAlertMessage(message);
    setShowAlertModal(true);
  };

  const showConfirm = (message: string, callback: () => void) => {
    setConfirmMessage(message);
    setConfirmCallback(() => callback);
    setShowConfirmModal(true);
  };

  const handleConfirm = () => {
    if (confirmCallback) {
      confirmCallback();
    }
    setShowConfirmModal(false);
    setConfirmCallback(null);
  };

  const openCommitModal = () => {
    if (uncommittedFiles.size === 0) {
      showAlert('No changes to commit');
      return;
    }
    setShowCommitModal(true);
  };

  const commitChanges = async () => {
    if (!commitMessage.trim()) {
      showAlert('Please enter a commit message');
      return;
    }
    
    try {
      await fetch(`${API_URL}/api/repo/${currentRepo}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage, token, repoUrl, provider: gitProvider })
      });
      setShowCommitModal(false);
      setCommitMessage('');
      loadGitStatus(currentRepo);
      showAlert('Changes committed and pushed!');
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
          <select 
            value={gitProvider} 
            onChange={(e) => setGitProvider(e.target.value as 'github' | 'gitlab')}
            className="provider-select"
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
          <input
            type="text"
            placeholder="Repository URL"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <input
            type="password"
            placeholder="Access Token"
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
            <>
              <div className="editor-toolbar">
                <button 
                  onClick={handleUndo} 
                  disabled={historyIndex <= 0}
                  className="toolbar-btn"
                  title="Undo (Ctrl+Z)"
                >
                  ↶ Undo
                </button>
                <button 
                  onClick={saveFile} 
                  disabled={!currentFile || content === originalContent}
                  className="toolbar-btn save-btn"
                  title="Save file"
                >
                  💾 Save
                </button>
                <button 
                  onClick={revertChanges} 
                  disabled={content === originalContent}
                  className="toolbar-btn revert-btn"
                  title="Revert all unsaved changes"
                >
                  ↺ Revert
                </button>
                <span className="file-status">
                  {content !== originalContent && <span className="unsaved-indicator">● Unsaved changes</span>}
                </span>
              </div>
              <MDEditor
                value={content}
                onChange={(val) => {
                  const newContent = val || '';
                  setContent(newContent);
                  
                  // Update edit history
                  const newHistory = editHistory.slice(0, historyIndex + 1);
                  newHistory.push(newContent);
                  setEditHistory(newHistory);
                  setHistoryIndex(newHistory.length - 1);
                  
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
                height={550}
              data-color-mode="light"
              previewOptions={{
                components: {
                  code: ({ inline, children = [], className, ...props }: any) => {
                    if (inline) {
                      return <code>{children}</code>;
                    }
                    
                    // Extract the actual code content from React elements
                    const extractText = (node: any): string => {
                      if (typeof node === 'string') {
                        return node;
                      }
                      if (Array.isArray(node)) {
                        return node.map(extractText).join('');
                      }
                      if (node && typeof node === 'object' && node.props && node.props.children) {
                        return extractText(node.props.children);
                      }
                      return '';
                    };
                    
                    const codeString = extractText(children);
                    
                    // Check if it's a mermaid code block
                    if (
                      typeof className === 'string' &&
                      /^language-mermaid/.test(className.toLowerCase())
                    ) {
                      return (
                        <code className="mermaid" style={{ display: 'block', whiteSpace: 'pre' }}>
                          {codeString}
                        </code>
                      );
                    }
                    
                    return <code className={String(className)}>{children}</code>;
                  },
                },
              }}
              />
            </>
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

      {/* Alert Modal */}
      {showAlertModal && (
        <div className="modal-overlay">
          <div className="alert-modal">
            <div className="alert-content">
              <p>{alertMessage}</p>
            </div>
            <div className="alert-buttons">
              <button onClick={() => setShowAlertModal(false)} className="alert-ok-btn">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {showConfirmModal && (
        <div className="modal-overlay">
          <div className="confirm-modal">
            <div className="confirm-content">
              <p>{confirmMessage}</p>
            </div>
            <div className="confirm-buttons">
              <button onClick={() => setShowConfirmModal(false)} className="confirm-cancel-btn">Cancel</button>
              <button onClick={handleConfirm} className="confirm-ok-btn">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;