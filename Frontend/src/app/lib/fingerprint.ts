/**
 * fingerprint.ts — Recolecta toda la metadata que el navegador puede exponer
 * sobre el visitante, para adjuntarla al comentario del muro.
 *
 * Límite real: el navegador NO expone el "nombre del equipo" ni la IP pública
 * (esa la ve el servidor). Sí podemos sacar: SO/navegador, idioma, zona horaria,
 * pantalla, CPU/RAM aproximadas, GPU (WebGL), red, e IPs locales vía WebRTC
 * (best-effort; muchos navegadores lo bloquean).
 */

function webglInfo(): { vendor?: string; renderer?: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return {};
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return {};
    return {
      vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string,
      renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string,
    };
  } catch {
    return {};
  }
}

// IPs locales vía WebRTC (best-effort, con timeout). Suele fallar en navegadores
// modernos que ofuscan con mDNS (.local), pero lo intentamos igualmente.
function ipsLocalesWebRTC(timeoutMs = 1200): Promise<string[]> {
  return new Promise((resolve) => {
    const ips = new Set<string>();
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    } catch {
      resolve([]);
      return;
    }
    const done = () => {
      try { pc.close(); } catch { /* noop */ }
      resolve([...ips]);
    };
    const timer = setTimeout(done, timeoutMs);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { clearTimeout(timer); done(); return; }
      const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){7})/i.exec(e.candidate.candidate);
      if (m) ips.add(m[1]);
    };
    try {
      pc.createDataChannel('x');
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => done());
    } catch {
      clearTimeout(timer);
      done();
    }
  });
}

export async function recolectarFingerprint(): Promise<Record<string, unknown>> {
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  const gl = webglInfo();

  const fp: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    plataforma: nav.platform,
    idioma: navigator.language,
    idiomas: navigator.languages,
    zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetUTCmin: new Date().getTimezoneOffset(),
    horaLocal: new Date().toString(),
    nucleosCPU: nav.hardwareConcurrency ?? null,
    memoriaGB: nav.deviceMemory ?? null,
    touchPoints: nav.maxTouchPoints ?? 0,
    cookiesHabilitadas: navigator.cookieEnabled,
    doNotTrack: nav.doNotTrack ?? null,
    pantalla: {
      ancho: screen.width, alto: screen.height,
      dispAncho: screen.availWidth, dispAlto: screen.availHeight,
      profColor: screen.colorDepth, pixelRatio: window.devicePixelRatio,
    },
    viewport: { ancho: window.innerWidth, alto: window.innerHeight },
    gpu: gl,
    red: conn ? { tipo: conn.effectiveType, downlinkMbps: conn.downlink, rttMs: conn.rtt } : null,
  };

  try {
    fp.ipsLocales = await ipsLocalesWebRTC();
  } catch {
    fp.ipsLocales = [];
  }
  return fp;
}
