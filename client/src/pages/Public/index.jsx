import { useCallback } from 'react';
import { useParams } from 'react-router-dom';

import logo from '../../assets/logo.png';
import useApiResource from '../../hooks/useApiResource';
import PublicCard from './PublicCard/PublicCard';
import { Text, AstroLoader, ErrorState, EmptyState, OfflineBanner } from '../../components/ui';
import { taskApi } from '../../services';

import styles from './index.module.css';

export default function PublicLayout() {
  const { taskId } = useParams();

  const fetchTask = useCallback(
    ({ signal }) => taskApi.getPublic(taskId, { signal }),
    [taskId]
  );

  const { data, isLoading, error, retry } = useApiResource(fetchTask, [taskId]);

  let content;

  if (isLoading) {
    content = (
      <div className={styles.center}>
        <AstroLoader />
        <Text color="var(--text-muted)">Loading task…</Text>
      </div>
    );
  } else if (error) {
    // A 404 is an expected outcome for a share link, not a fault: the task may
    // have been deleted, or the link mistyped. It gets its own calmer message
    // and no retry button, since retrying cannot help.
    content =
      error.status === 404 ? (
        <EmptyState
          title="This task isn’t available"
          description="The link may be incorrect, or the task may have been deleted by its owner."
        />
      ) : (
        <ErrorState
          title="Couldn’t load this task"
          description="Something went wrong fetching the shared task."
          onRetry={retry}
          isRetrying={isLoading}
        />
      );
  } else if (data) {
    content = <PublicCard task={data.data.task} />;
  }

  return (
    <div className={styles.container}>
      <header className={styles.logo}>
        <div className={styles.image}>
          <img src={logo} alt="" />
        </div>

        <Text as="span" step={4} weight="600">
          Pro Manage
        </Text>
      </header>

      <main className={styles.main}>{content}</main>

      <OfflineBanner />
    </div>
  );
}
