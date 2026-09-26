/** A wooden gavel knock and a paddle click, synthesised with Web Audio. No files. */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function knock(ac: AudioContext, at: number, gain = 0.9) {
  // Body: a quick pitch-dropping sine, like wood on wood.
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, at);
  osc.frequency.exponentialRampToValueAtTime(70, at + 0.12);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + 0.2);
  // Crack: a burst of band-passed noise.
  const len = Math.floor(ac.sampleRate * 0.05);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.value = gain * 0.7;
  src.connect(bp).connect(ng).connect(ac.destination);
  src.start(at);
}

export function playGavel(sold: boolean) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  knock(ac, t, 0.8);
  if (sold) knock(ac, t + 0.22, 1);
}

export function playBid() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(900, t);
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.07);
}
