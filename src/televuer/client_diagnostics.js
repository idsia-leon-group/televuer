/* Opt-in /xr diagnostics: metadata only; no images or pose payloads are logged. */
(() => {
  const state = {wsOpen: 0, wsMessages: 0, wsBytes: 0, xrFrames: 0, xrMode: null};
  const client = crypto.randomUUID();
  let lastMessage = null;
  let lastFrame = null;
  let previous = performance.now();
  let previousFrames = 0;
  let reports = 0;
  function report(event, detail = {}) {
    // Bound error floods as well as individual records.
    if (++reports > 30) return;
    const now = performance.now();
    const body = JSON.stringify({client, event, ...state,
      wsAgeMs: lastMessage === null ? null : Math.round(now - lastMessage),
      xrAgeMs: lastFrame === null ? null : Math.round(now - lastFrame),
      visibility: document.visibilityState, ...detail});
    navigator.sendBeacon('/diagnostics/client', new Blob([body], {type: 'application/json'}));
  }
  window.addEventListener('error', (e) => report('error', {
    message: String(e.message || 'resource error').slice(0, 1000),
    source: String(e.filename || e.target?.src || '').slice(0, 500),
    stack: String(e.error?.stack || '').slice(0, 1500)
  }), true);
  window.addEventListener('unhandledrejection', (e) => report('rejection', {
    message: String(e.reason?.stack || e.reason).slice(0, 2000)
  }));
  document.addEventListener('webglcontextlost', () => report('webglcontextlost'), true);
  document.addEventListener('webglcontextrestored', () => report('webglcontextrestored'), true);
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('open', () => {state.wsOpen++; report('ws-open');});
      this.addEventListener('message', (e) => {
        state.wsMessages++;
        state.wsBytes += e.data.byteLength ?? e.data.size ?? e.data.length ?? 0;
        lastMessage = performance.now();
      });
      this.addEventListener('close', (e) => {
        state.wsOpen = Math.max(0, state.wsOpen - 1);
        report('ws-close', {code: e.code, clean: e.wasClean});
      });
      this.addEventListener('error', () => report('ws-error'));
    }
  };
  if (navigator.xr) {
    const requestSession = navigator.xr.requestSession.bind(navigator.xr);
    navigator.xr.requestSession = async (mode, options) => {
      report('xr-request', {mode});
      try {
        const session = await requestSession(mode, options);
        state.xrMode = mode;
        report('xr-start', {sessionVisibility: session.visibilityState});
        // Count the application's actual XR callbacks, without a second render loop.
        const requestFrame = session.requestAnimationFrame.bind(session);
        session.requestAnimationFrame = (callback) => requestFrame((time, frame) => {
          state.xrFrames++;
          lastFrame = performance.now();
          callback(time, frame);
        });
        session.addEventListener('visibilitychange', () => report('xr-visibility', {
          sessionVisibility: session.visibilityState
        }));
        session.addEventListener('end', () => {state.xrMode = null; report('xr-end');});
        return session;
      } catch (error) {
        report('xr-request-failed', {message: String(error).slice(0, 1000)});
        throw error;
      }
    };
  }
  setInterval(() => {
    reports = 0;
    const now = performance.now();
    const xrFps = Math.round(1000 * (state.xrFrames - previousFrames) / (now - previous));
    previous = now;
    previousFrames = state.xrFrames;
    report('heartbeat', {xrFps});
  }, 5000);
  report('page', {secureContext: window.isSecureContext, webXR: !!navigator.xr,
    userAgent: navigator.userAgent});
})();
