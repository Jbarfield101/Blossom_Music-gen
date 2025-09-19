import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import JobQueuePanel from '../components/JobQueuePanel.jsx';
import { useJobQueue } from '../lib/useJobQueue.js';

export default function Queue() {
  const { queue, refresh } = useJobQueue(2000);

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
        <button type="button" onClick={refresh}>Refresh</button>
      </div>
      <JobQueuePanel queue={queue} onCancel={onCancel} />
    </>
  );
}

