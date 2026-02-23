import React, { useCallback, useEffect, useState } from 'react';

// Types
interface FileCoverage {
  filePath: string;
  linesCoverage: number;
}

const JobStatus = {
  QUEUED: 'QUEUED',
  CLONING: 'CLONING',
  ANALYZING: 'ANALYZING',
  GENERATING: 'GENERATING',
  PUSHING: 'PUSHING',
  PR_CREATED: 'PR_CREATED',
  FAILED: 'FAILED',
} as const;

type JobStatus = typeof JobStatus[keyof typeof JobStatus];

const STATUS_LABELS: Record<JobStatus, string> = {
  [JobStatus.QUEUED]: 'Queued',
  [JobStatus.CLONING]: 'Cloning',
  [JobStatus.ANALYZING]: 'Analyzing',
  [JobStatus.GENERATING]: 'Generating',
  [JobStatus.PUSHING]: 'Pushing',
  [JobStatus.PR_CREATED]: 'PR Open',
  [JobStatus.FAILED]: 'Failed',
};

interface ImprovementJob {
  id: string;
  repositoryUrl: string;
  filePath: string;
  targetCoverage: number;
  status: JobStatus;
  prLink?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface TrackedRepository {
  id: string;
  url: string;
  lastCoverageReport: FileCoverage[] | null;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = 'http://localhost:3000/api';

function App() {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedRepo, setSelectedRepo] = useState<TrackedRepository | null>(null);

  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [addRepoError, setAddRepoError] = useState<string | null>(null);
  const [repos, setRepos] = useState<TrackedRepository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  // repoId → updatedAt snapshot taken at the moment scan was enqueued
  const [scanningRepos, setScanningRepos] = useState<Record<string, string>>({});

  const [jobs, setJobs] = useState<Record<string, ImprovementJob>>({});

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/repos`);
      if (!res.ok) throw new Error('Failed to fetch repos');
      const data: TrackedRepository[] = await res.json();
      setRepos(data);

      // Update selectedRepo if it's currently selected
      setSelectedRepo(prev => {
        if (!prev) return null;
        const updated = data.find(r => r.id === prev.id);
        return updated || prev;
      });

      // Clear scanning state for repos whose updatedAt has advanced
      setScanningRepos(prev => {
        const next = { ...prev };
        let changed = false;
        for (const [id, snapshotTime] of Object.entries(prev)) {
          const fresh = data.find(r => r.id === id);
          if (fresh && fresh.updatedAt !== snapshotTime) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (err) {
      console.error('Error fetching repos:', err);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      if (!res.ok) throw new Error('Failed to fetch jobs');
      const data: ImprovementJob[] = await res.json();
      
      setJobs((prev) => {
        const newJobsMap = { ...prev };
        let changed = false;
        
        data.forEach(job => {
          const prevJob = prev[job.id];
          if (!prevJob || prevJob.status !== job.status || prevJob.updatedAt !== job.updatedAt) {
            newJobsMap[job.id] = job;
            changed = true;
          }
        });
        
        return changed ? newJobsMap : prev;
      });
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    fetchRepos();
    fetchJobs();
  }, [fetchRepos, fetchJobs]);

  const hasActiveJobs = Object.values(jobs).some(job =>
    ([JobStatus.QUEUED, JobStatus.CLONING, JobStatus.ANALYZING, JobStatus.GENERATING, JobStatus.PUSHING] as JobStatus[]).includes(job.status)
  );
  const hasScansInFlight = Object.keys(scanningRepos).length > 0;

  // Smart Polling: Poll ONLY when jobs are active OR scans are in flight
  useEffect(() => {
    if (!hasActiveJobs && !hasScansInFlight) return;

    const intervalId = setInterval(() => {
      fetchJobs();
      if (hasScansInFlight) fetchRepos();
    }, 2000);
    return () => clearInterval(intervalId);
  }, [hasActiveJobs, hasScansInFlight, fetchJobs, fetchRepos]);

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrlInput) return;
    
    setLoadingRepos(true);
    setAddRepoError(null);
    try {
      let res = await fetch(`${API_BASE}/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryUrl: repoUrlInput })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errorData.message || 'Failed to add repository');
      }
      
      const repo: TrackedRepository = await res.json();
      setRepoUrlInput('');
      
      // Since the backend now triggers an automatic scan on add,
      // we immediately put it in the scanning state in the UI.
      setScanningRepos(prev => ({ ...prev, [repo.id]: repo.updatedAt }));
      
      await fetchRepos();
    } catch (err: any) {
      setAddRepoError(err.message);
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleScanRepo = async (repoId: string) => {
    // Snapshot current updatedAt so we know when the worker finishes
    const currentRepo = repos.find(r => r.id === repoId) ||
      (selectedRepo?.id === repoId ? selectedRepo : null);
    const snapshot = currentRepo?.updatedAt ?? new Date().toISOString();

    setScanningRepos(prev => ({ ...prev, [repoId]: snapshot }));
    try {
      const res = await fetch(`${API_BASE}/repos/${repoId}/scan`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      // Response is { queued: true, repoId } — worker will do the heavy lifting
    } catch (err: any) {
      alert(`Error queuing scan: ${err.message}`);
      setScanningRepos(prev => { const n = { ...prev }; delete n[repoId]; return n; });
    }
  };

  const handleImprove = async (filePath: string) => {
    if (!selectedRepo) return;
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryUrl: selectedRepo.url, filePath })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const job: ImprovementJob = await res.json();
      setJobs(prev => ({ ...prev, [job.id]: job }));
    } catch (err: any) {
      alert(`Error starting job: ${err.message}`);
    }
  };

  const handleImproveAll = async (files: string[]) => {
    for (const file of files) {
      await handleImprove(file);
    }
  };

  const goToDetail = (repo: TrackedRepository) => {
    setSelectedRepo(repo);
    setView('detail');
  };

  const goToList = () => {
    setSelectedRepo(null);
    setView('list');
  };

  // Helper to find Active job for a file in detailed view
  const getJobForFile = (filePath: string) => {
    if (!selectedRepo) return undefined;
    return Object.values(jobs)
      .filter(j => j.repositoryUrl === selectedRepo.url && j.filePath === filePath)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-blue-100">
      {/* Minimal Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex flex-col sm:flex-row justify-between items-center">
          <div className="font-semibold text-gray-800 flex items-center gap-2 cursor-pointer" onClick={goToList}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>
            TS Coverage Improver
          </div>
          <div className="text-sm text-gray-500 hidden sm:block">
            Automated test generation
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        {view === 'list' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Simple URL Input */}
            <section className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Track a new repository</h2>
              <form onSubmit={handleAddRepo} className="flex flex-col sm:flex-row gap-3">
                <input 
                  type="url" 
                  placeholder="https://github.com/owner/repo"
                  className={`flex-1 px-4 py-2.5 bg-gray-50 border ${addRepoError ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500/20 focus:border-blue-500'} rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 transition-colors`}
                  value={repoUrlInput}
                  onChange={(e) => { setRepoUrlInput(e.target.value); setAddRepoError(null); }}
                  required
                />
                <button 
                  type="submit" 
                  disabled={loadingRepos}
                  className="px-6 py-2.5 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {loadingRepos ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Adding...
                    </>
                  ) : 'Add Repository'}
                </button>
              </form>
              {addRepoError && (
                <p className="text-sm text-red-600 mt-2 pl-2 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  {addRepoError}
                </p>
              )}
              {!addRepoError && (
                <p className="text-xs text-gray-500 mt-2 pl-2">Example: https://github.com/georg-ep/test-ts-repo</p>
              )}
            </section>

            {/* Repositories List */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                Tracked Repositories
              </h2>
              {repos.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 flex flex-col items-center justify-center text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-gray-300"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  <p className="text-sm font-medium text-gray-600">No repositories yet</p>
                  <p className="text-xs mt-1">Add a repository above to start tracking coverage.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {repos.map(repo => {
                    const isScanning = !!scanningRepos[repo.id];
                    const coverageFiles = repo.lastCoverageReport || [];
                    const needsImprovementCount = coverageFiles.filter(f => f.linesCoverage < 80).length;

                    return (
                      <div 
                        key={repo.id} 
                        onClick={() => goToDetail(repo)}
                        className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:border-blue-400 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between h-36 relative overflow-hidden group"
                      >
                        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-blue-50 to-transparent rounded-bl-[100px] opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div>
                          <p className="font-mono text-sm text-gray-800 font-medium truncate pr-4" title={repo.url}>
                            {repo.url.replace('https://github.com/', '')}
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            {isScanning ? (
                              <span className="text-xs font-medium text-blue-600 flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded-md">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                </span>
                                Scanning...
                              </span>
                            ) : repo.lastCoverageReport === null ? (
                              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-md">Pending scan</span>
                            ) : (
                              <span className={`text-xs font-semibold px-2 py-1 rounded-md ${needsImprovementCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {needsImprovementCount} files need coverage
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-4 flex items-center justify-between">
                          <span>Added {new Date(repo.createdAt).toLocaleDateString()}</span>
                          <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity font-medium flex items-center gap-1">
                            View Details <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {view === 'detail' && selectedRepo && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
            {/* Detail Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <button 
                  onClick={goToList}
                  className="mb-4 text-sm font-medium text-gray-500 hover:text-gray-900 flex items-center gap-1.5 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                  Back to Repositories
                </button>
                <h1 className="text-2xl font-bold text-gray-900 font-mono tracking-tight break-all">
                  {selectedRepo.url.replace('https://github.com/', '')}
                </h1>
                <p className="text-sm text-gray-500 mt-1">Last updated: {new Date(selectedRepo.updatedAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                {selectedRepo.lastCoverageReport && (
                  <button
                    onClick={() => {
                      const improvable = selectedRepo.lastCoverageReport!
                        .filter(f => {
                          const job = getJobForFile(f.filePath);
                          return f.linesCoverage < 80 && (!job || (job.status !== JobStatus.PR_CREATED && !([JobStatus.QUEUED, JobStatus.CLONING, JobStatus.ANALYZING, JobStatus.GENERATING, JobStatus.PUSHING] as JobStatus[]).includes(job.status)));
                        })
                        .map(f => f.filePath);
                      handleImproveAll(improvable);
                    }}
                    disabled={!selectedRepo.lastCoverageReport || selectedRepo.lastCoverageReport.filter(f => {
                      const job = getJobForFile(f.filePath);
                      return f.linesCoverage < 80 && (!job || (job.status !== JobStatus.PR_CREATED && !([JobStatus.QUEUED, JobStatus.CLONING, JobStatus.ANALYZING, JobStatus.GENERATING, JobStatus.PUSHING] as JobStatus[]).includes(job.status)));
                    }).length === 0}
                    className="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 transition-all flex items-center gap-2 shadow-sm whitespace-nowrap border border-transparent"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 14 4-4"/><path d="m3 3.5 1.5 1.5 1.5-1.5"/><path d="M12 2v12"/><path d="M22 19H2"/><path d="M19 19v-7c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v7"/></svg>
                    Improve All ({selectedRepo.lastCoverageReport.filter(f => {
                      const job = getJobForFile(f.filePath);
                      return f.linesCoverage < 80 && (!job || (job.status !== JobStatus.PR_CREATED && !([JobStatus.QUEUED, JobStatus.CLONING, JobStatus.ANALYZING, JobStatus.GENERATING, JobStatus.PUSHING] as JobStatus[]).includes(job.status)));
                    }).length})
                  </button>
                )}
                <button 
                  onClick={() => handleScanRepo(selectedRepo.id)}
                  disabled={!!scanningRepos[selectedRepo.id]}
                  className="px-5 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-sm whitespace-nowrap"
                >
                  {!!scanningRepos[selectedRepo.id] ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Scanning...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                      Rescan Coverage
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Content Layout */}
            <div>
              
              {/* Main Area: Files */}
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                  Files Coverage
                  {selectedRepo.lastCoverageReport && (
                    <span className="bg-gray-200 text-gray-700 py-0.5 px-2 rounded-md text-xs">{selectedRepo.lastCoverageReport.length}</span>
                  )}
                </h2>

                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden min-h-[400px]">
                  {!!scanningRepos[selectedRepo.id] ? (
                    <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-gray-400 space-y-3">
                      <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
                      <p className="text-sm">Fetching and analyzing repository...</p>
                    </div>
                  ) : !selectedRepo.lastCoverageReport ? (
                    <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-gray-400 space-y-3">
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      <p className="text-sm font-medium text-gray-600">No coverage data yet</p>
                      <p className="text-xs">Click "Rescan Coverage" to analyze this repository.</p>
                      <button 
                        onClick={() => handleScanRepo(selectedRepo.id)}
                        className="mt-2 px-4 py-2 bg-blue-50 text-blue-600 font-medium rounded-md hover:bg-blue-100 transition-colors text-sm"
                      >
                        Scan Now
                      </button>
                    </div>
                  ) : selectedRepo.lastCoverageReport.length === 0 ? (
                    <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-gray-400 space-y-2 text-center p-6">
                      <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                      <p className="text-sm font-medium text-gray-800">Perfect Coverage</p>
                      <p className="text-xs max-w-xs leading-relaxed">No files found with missing coverage. This repository is in great shape!</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {selectedRepo.lastCoverageReport.map((file) => {
                        const job = getJobForFile(file.filePath);
                        const needsImprovement = file.linesCoverage < 80;
                        
                        const processingStatuses: JobStatus[] = [
                          JobStatus.QUEUED, 
                          JobStatus.CLONING, 
                          JobStatus.ANALYZING, 
                          JobStatus.GENERATING, 
                          JobStatus.PUSHING
                        ];
                        const isProcessing = job && processingStatuses.includes(job.status);
                        
                        return (
                          <li key={file.filePath} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <p className="font-mono text-sm text-gray-800 truncate" title={file.filePath}>
                                {file.filePath}
                              </p>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className={`text-xs font-semibold ${needsImprovement ? 'text-red-600' : 'text-emerald-600'}`}>
                                  {Math.round(file.linesCoverage)}%
                                </span>
                                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full ${needsImprovement ? 'bg-red-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.round(file.linesCoverage)}%` }}
                                  ></div>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex-shrink-0 flex items-center gap-2">
                              {needsImprovement && !isProcessing && job?.status !== JobStatus.PR_CREATED && (
                                <button 
                                  onClick={() => handleImprove(file.filePath)}
                                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                                >
                                  Improve
                                </button>
                              )}
                              {isProcessing && (
                                <span className="text-xs font-medium text-gray-500 flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-md border border-gray-100">
                                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                  {STATUS_LABELS[job.status]}...
                                </span>
                              )}
                              {job?.status === JobStatus.PR_CREATED && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleImprove(file.filePath)}
                                    title="Regenerate PR"
                                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 bg-gray-50 rounded-md border border-gray-200 transition-colors"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                  </button>
                                  <a 
                                    href={job.prLink} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 px-3 py-1.5 bg-blue-50 rounded-md border border-blue-100 transition-colors"
                                  >
                                    View PR ↗
                                  </a>
                                </div>
                              )}
                              {job?.status === JobStatus.FAILED && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleImprove(file.filePath)}
                                    title="Retry Generation"
                                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 bg-gray-50 rounded-md border border-gray-200 transition-colors"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                  </button>
                                  <span className="text-xs font-medium text-red-600 flex items-center gap-1 px-3 py-1.5 bg-red-50 rounded-md border border-red-100 cursor-help" title={job.errorMessage}>
                                    Failed
                                  </span>
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
