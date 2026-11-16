// Synthesised sound: every effect is built from oscillators and filtered noise, so the
// game ships no audio files. The context starts on the first user gesture; shot captures
// run silent.
export function createAudio() {
  let context = null;
  let master = null;

  function ensure() {
    if (context) return true;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.35;
      master.connect(context.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * seconds)), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ seconds, type = 'lowpass', frequency = 1200, gain = 0.5, at = 0 }) {
    if (!context) return;
    const time = context.currentTime + at;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(seconds);
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + seconds);
    source.connect(filter).connect(envelope).connect(master);
    source.start(time);
    source.stop(time + seconds + 0.02);
  }

  function tone({ frequency, endFrequency = null, seconds, type = 'sine', gain = 0.3, at = 0 }) {
    if (!context) return;
    const time = context.currentTime + at;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (endFrequency !== null) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + seconds);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + seconds);
    oscillator.connect(envelope).connect(master);
    oscillator.start(time);
    oscillator.stop(time + seconds + 0.02);
  }

  const SHOT = {
    pistol: { seconds: 0.09, frequency: 1400, gain: 0.5 },
    smg: { seconds: 0.07, frequency: 1800, gain: 0.4 },
    rifle: { seconds: 0.12, frequency: 900, gain: 0.6 },
  };

  return {
    unlock() { ensure(); if (context && context.state === 'suspended') context.resume(); },
    shot(id) {
      if (!ensure()) return;
      const preset = SHOT[id] || SHOT.rifle;
      burst(preset);
      tone({ frequency: 160, endFrequency: 60, seconds: 0.08, type: 'triangle', gain: 0.4 });
    },
    dryFire() { if (ensure()) tone({ frequency: 1200, seconds: 0.03, type: 'square', gain: 0.12 }); },
    reload() {
      if (!ensure()) return;
      tone({ frequency: 700, seconds: 0.04, type: 'square', gain: 0.15 });
      tone({ frequency: 900, seconds: 0.04, type: 'square', gain: 0.15, at: 0.35 });
    },
    hit() { if (ensure()) tone({ frequency: 2400, seconds: 0.05, type: 'sine', gain: 0.25 }); },
    kill() {
      if (!ensure()) return;
      tone({ frequency: 1800, seconds: 0.06, type: 'sine', gain: 0.3 });
      tone({ frequency: 2400, seconds: 0.08, type: 'sine', gain: 0.3, at: 0.06 });
    },
    plantBeep() { if (ensure()) tone({ frequency: 1100, seconds: 0.12, type: 'square', gain: 0.2 }); },
    defuseBeep() { if (ensure()) tone({ frequency: 1500, seconds: 0.12, type: 'square', gain: 0.2 }); },
    explosion() {
      if (!ensure()) return;
      burst({ seconds: 0.9, frequency: 400, gain: 0.9 });
      tone({ frequency: 90, endFrequency: 30, seconds: 0.8, type: 'sine', gain: 0.8 });
    },
    click() { if (ensure()) tone({ frequency: 2000, seconds: 0.03, type: 'square', gain: 0.1 }); },
    roundWin() {
      if (!ensure()) return;
      tone({ frequency: 523, seconds: 0.14, type: 'triangle', gain: 0.3 });
      tone({ frequency: 659, seconds: 0.14, type: 'triangle', gain: 0.3, at: 0.13 });
      tone({ frequency: 784, seconds: 0.24, type: 'triangle', gain: 0.3, at: 0.26 });
    },
    roundLose() {
      if (!ensure()) return;
      tone({ frequency: 392, seconds: 0.16, type: 'triangle', gain: 0.3 });
      tone({ frequency: 311, seconds: 0.28, type: 'triangle', gain: 0.3, at: 0.15 });
    },
  };
}
