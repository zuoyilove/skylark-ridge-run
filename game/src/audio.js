// Synthesised sound, no audio files: a WebAudio engine hum whose pitch follows
// the throttle, wind that rises with speed, a chime for a ring, a thud for a
// touchdown and a crunch for a crash. Nothing is created until the first user
// gesture, so browsers allow it.
export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let windSource = null;
  let windGain = null;
  let windFilter = null;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return true;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
    } catch {
      return false;
    }
    // Engine: two detuned saws through a low-pass, quiet at idle.
    engineOsc = context.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = context.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 55 * 1.007;
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = context.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(context.destination);
    engineOsc.start();
    engineOsc2.start();
    // Wind: looped noise through a band-pass, loud only when fast.
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    windSource = context.createBufferSource();
    windSource.buffer = buffer;
    windSource.loop = true;
    windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    windGain = context.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(context.destination);
    windSource.start();
    return true;
  }

  function tone(freq, when, dur, type, vol) {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(vol, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    // Called every frame with the plane's state; the hum and wind follow it.
    update(speed, throttle, flying) {
      if (!context) return;
      const t = context.currentTime;
      const target = flying || speed > 2 ? 0.05 + throttle * 0.05 : 0;
      engineGain.gain.setTargetAtTime(target, t, 0.1);
      const freq = 48 + throttle * 70 + speed * 0.35;
      engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
      engineOsc2.frequency.setTargetAtTime(freq * 1.007, t, 0.1);
      windGain.gain.setTargetAtTime(Math.min(0.12, Math.max(0, speed - 25) * 0.0022), t, 0.2);
      windFilter.frequency.setTargetAtTime(500 + speed * 9, t, 0.2);
    },
    ring() {
      if (!ensure()) return;
      const t = context.currentTime;
      tone(880, t, 0.35, 'sine', 0.22);
      tone(1318.5, t + 0.09, 0.4, 'sine', 0.18);
    },
    touchdown() {
      if (!ensure()) return;
      const t = context.currentTime;
      tone(120, t, 0.18, 'sine', 0.3);
      tone(660, t + 0.05, 0.3, 'sine', 0.14);
    },
    crash() {
      if (!ensure()) return;
      const t = context.currentTime;
      tone(90, t, 0.5, 'sawtooth', 0.25);
      tone(55, t + 0.08, 0.6, 'sawtooth', 0.2);
    },
    fuelWarning() {
      if (!ensure()) return;
      const t = context.currentTime;
      tone(440, t, 0.12, 'square', 0.08);
      tone(440, t + 0.18, 0.12, 'square', 0.08);
    },
  };
}
