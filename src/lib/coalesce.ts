/**
 * `run`, one call at a time. A call made while one runs gets that run's promise and has it run
 * once more when it ends (however many calls came meanwhile), so every caller sees a run that
 * started after it asked.
 */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await run();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
