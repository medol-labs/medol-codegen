export async function waitUntil(label, probe, {timeoutMs = 30000, intervalMs = 500, signal, details = () => ''} = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid readiness timing');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    let timer, delay;
    const timeout = new Error(`Timed out waiting for ${label}`);
    const interrupted = new Promise((_, reject) => {
        const rejectAbort = () => reject(controller.signal.reason || new Error('Readiness aborted'));
        controller.signal.addEventListener('abort', rejectAbort, {once: true});
        if (controller.signal.aborted) rejectAbort();
        timer = setTimeout(() => controller.abort(timeout), timeoutMs);
    });
    try {
        while (true) {
            const value = await Promise.race([interrupted, Promise.resolve().then(() => {
                controller.signal.throwIfAborted();
                return probe(controller.signal);
            })]);
            if (value) return value;
            await Promise.race([interrupted, new Promise(done => { delay = setTimeout(done, intervalMs); })]);
        }
    } catch (error) {
        if (error === timeout) throw new Error(`${timeout.message}. ${details()}`.trim());
        throw error;
    } finally {
        clearTimeout(timer);
        clearTimeout(delay);
        signal?.removeEventListener('abort', abort);
    }
}
