const COMMIT_TIMEOUT_MS = 4000;

export function commitLocal(write: Promise<unknown>, timeoutMs = COMMIT_TIMEOUT_MS): Promise<void> {
  const swallow = (e: unknown) => console.warn("Firestore write failed", e);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    write.catch(swallow);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      write.catch(swallow);
      resolve();
    }, timeoutMs);
    write.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
