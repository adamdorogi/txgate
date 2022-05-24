export function background(work: () => Promise<boolean>, interval: number, onError: (error: unknown) => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  const run = () => {
    pending = (async () => {
      let more = false;
      try {
        more = await work();
      } catch (error) {
        onError(error);
      } finally {
        if (!stopped) timer = setTimeout(run, more ? 10 : interval);
      }
    })();
  };
  run();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await pending;
  };
}
