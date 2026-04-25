const pendingConsoleLogTasks = new Set<Promise<unknown>>();
const pendingConsoleRequestWrites = new Map<string, Promise<void>>();

export function trackPendingConsoleLogTask(task: Promise<unknown>): void {
  pendingConsoleLogTasks.add(task);
  void task.finally(() => {
    pendingConsoleLogTasks.delete(task);
  });
}

export async function waitForPendingConsoleLogTasks(): Promise<void> {
  while (pendingConsoleLogTasks.size > 0) {
    await Promise.allSettled(Array.from(pendingConsoleLogTasks));
  }
}

export function getPendingConsoleLogTaskCount(): number {
  return pendingConsoleLogTasks.size;
}

export function getPendingConsoleRequestWriteCount(): number {
  return pendingConsoleRequestWrites.size;
}

export function trackPendingConsoleRequestWrite(requestId: string, taskFactory: () => Promise<void>): Promise<void> {
  const previousTask = pendingConsoleRequestWrites.get(requestId);
  const task = (previousTask ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => taskFactory());

  pendingConsoleRequestWrites.set(requestId, task);
  trackPendingConsoleLogTask(task);
  void task.finally(() => {
    if (pendingConsoleRequestWrites.get(requestId) === task) {
      pendingConsoleRequestWrites.delete(requestId);
    }
  });

  return task;
}

export async function waitForPendingConsoleRequestWrite(requestId: string): Promise<void> {
  await pendingConsoleRequestWrites.get(requestId);
}
