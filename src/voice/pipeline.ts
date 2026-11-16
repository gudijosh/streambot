/**
 * Convierte frases en audio de una en una, empezando a generar la siguiente mientras
 * suena la actual y entregando siempre el audio en orden.
 */
export async function speakSentences(
  sentences: AsyncIterable<string>,
  synthesize: (text: string, signal: AbortSignal) => Promise<Buffer>,
  onAudio: (pcm: Buffer) => void,
  signal: AbortSignal,
  maxInFlight = 2,
): Promise<void> {
  const results: Promise<Buffer>[] = [];
  let finished = false;
  let inFlight = 0;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const wait = () => new Promise<void>((resolve) => (wake = resolve));

  let failure: unknown = null;
  const producer = (async () => {
    try {
      for await (const sentence of sentences) {
        while (inFlight >= maxInFlight && !signal.aborted && !failure) await wait();
        if (signal.aborted || failure) return;
        inFlight++;
        const job = synthesize(sentence, signal).finally(() => {
          inFlight--;
          notify();
        });
        job.catch(() => {});
        results.push(job);
        notify();
      }
    } catch (err) {
      failure = err;
    } finally {
      finished = true;
      notify();
    }
  })();

  try {
    for (let i = 0; ; i++) {
      while (i >= results.length && !finished) await wait();
      if (i >= results.length) break;
      const pcm = await results[i];
      if (signal.aborted) return;
      onAudio(pcm);
    }
  } catch (err) {
    if (signal.aborted) return;
    failure = err;
    notify();
  }
  await producer;
  if (failure && !signal.aborted) throw failure;
}
