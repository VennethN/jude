export interface PreparedMicrophone {
  ready: Promise<{ stream: MediaStream; context: AudioContext }>;
  release: () => void;
}

function microphoneAllowedHere() {
  const policyDocument = document as Document & {
    permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
    featurePolicy?: { allowsFeature: (feature: string) => boolean };
  };
  return (policyDocument.permissionsPolicy ?? policyDocument.featurePolicy)?.allowsFeature('microphone') !== false;
}

function deviceError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new Error('microphone_denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('microphone_missing');
  if (name === 'NotReadableError' || name === 'AbortError') return new Error('microphone_device_busy');
  return new Error('microphone_open_failed');
}

// Start both browser-gated operations within the original button event. A prepared input is
// kept only through this one authorized hearing start, and is never restored on navigation.
export function prepareMicrophone(): PreparedMicrophone {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let released = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel!: (reason: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { cancel = reject; });
  function release() {
    if (released) return;
    released = true;
    clearTimeout(timeout);
    cancel(new Error('microphone_cancelled'));
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  async function open() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
      throw new Error('microphone_unsupported');
    if (!microphoneAllowedHere()) throw new Error('microphone_policy');
    try { context = new AudioContext({ sampleRate: 24000 }); }
    catch { throw new Error('microphone_audio_start'); }
    const activeContext = context;
    let device: Promise<MediaStream>;
    try {
      device = navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, noiseSuppression: true, echoCancellation: false },
      });
    } catch (error) { throw deviceError(error); }
    const requested = device.catch(error => { throw deviceError(error); }).then(input => {
      if (released) {
        input.getTracks().forEach(track => track.stop());
        throw new Error('microphone_cancelled');
      }
      stream = input;
      if (activeContext.state !== 'running') {
        timeout = setTimeout(() => cancel(new Error('microphone_audio_start')), 12000);
      }
      return input;
    });
    let resume: Promise<void>;
    try { resume = activeContext.resume(); }
    catch { resume = Promise.reject(new Error('microphone_audio_start')); }
    const [, input] = await Promise.all([
      resume.catch(() => { throw new Error('microphone_audio_start'); }), requested,
    ]);
    clearTimeout(timeout);
    return { stream: input, context: activeContext };
  }
  const ready = Promise.race([open(), cancelled]).catch(error => { release(); throw error; });
  // The case transaction and navigation can still be pending when OS permission is denied.
  void ready.catch(() => {});
  return { ready, release };
}
