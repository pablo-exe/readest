import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebDAVSyncComplete, useWebDAVSyncProgress } from './syncProgress';
import styles from './WebDAVSyncProgress.module.css';

/** A single thin line inside the search box; 100% is reserved for successful completion. */
export function WebDAVSyncProgress() {
  const _ = useTranslation();
  const progress = useWebDAVSyncProgress((s) => s.progress);
  const complete = useWebDAVSyncProgress(isWebDAVSyncComplete);
  const active = useWebDAVSyncProgress(
    (s) => s.scan === 'running' || s.sync === 'pending' || s.sync === 'running',
  );
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (!complete) return;
    const timer = setTimeout(() => setHidden(true), 1400);
    return () => clearTimeout(timer);
  }, [complete, active, progress]);
  if (!progress || hidden) return null;
  const value = complete ? 100 : Math.min(95, Math.round(progress * 100));
  return (
    <div
      className={styles['track']}
      role='progressbar'
      aria-label={_('Syncing…')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-busy={active}
    >
      <div className={styles['fill']} style={{ width: `${value}%` }} />
    </div>
  );
}
