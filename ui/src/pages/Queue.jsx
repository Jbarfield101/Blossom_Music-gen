import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import JobQueuePanel from '../components/JobQueuePanel.jsx';
import { useJobQueue } from '../lib/useJobQueue.js';

export default function Queue() {
  const { queue, refresh } = useJobQueue(2000);
  const [completedJobs, setCompletedJobs] = useState([]);

  const formatTimestamp = useCallback((value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const jobs = await invoke('list_completed_jobs');
      if (Array.isArray(jobs)) {
        setCompletedJobs(jobs);
      }
      refresh();
    } catch (err) {
      console.error('failed to load jobs', err);
    }
  }, [refresh]);

  useEffect(() => {
    refreshJobs();
    const timer = setInterval(refreshJobs, 5000);
    return () => clearInterval(timer);
  }, [refreshJobs]);

  const onCancel = useCallback(
    async (id) => {
      try {
        await invoke('cancel_job', { jobId: id });
      } catch (err) {
        console.error('failed to cancel job', err);
      } finally {
        refresh();
      }
    },
    [refresh]
  );

  return (
    <>
      <BackButton />
      <h1>Job Queue</h1>
      <div style={{ marginBottom: '1rem' }}>
        <button type="button" onClick={refreshJobs}>Refresh</button>
      </div>
      <JobQueuePanel queue={queue} onCancel={onCancel} />
      <section style={{ marginTop: '2rem' }}>
        <h2>Completed Jobs</h2>
        {completedJobs.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="job-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {completedJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.status}</td>
                    <td>{job.label || job.args?.[0] || ''}</td>
                    <td>{formatTimestamp(job.created_at || job.createdAt)}</td>
                    <td>{formatTimestamp(job.finished_at || job.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No completed jobs yet.</p>
        )}
      </section>
    </>
  );
}

