import { useCallback, useEffect, useRef, useState } from 'react';

const MUTE_KEY = 'jeopardy-muted';
let audioContext = null;

const getContext = () => {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
  }
  return audioContext;
};

const tone = (ctx, { frequency, startTime, duration, type = 'sine', gain = 0.18 }) => {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gainNode.gain.setValueAtTime(gain, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
};

const VOICES = {
  select: (ctx) => {
    const now = ctx.currentTime;
    tone(ctx, { frequency: 660, startTime: now, duration: 0.12 });
  },
  correct: (ctx) => {
    const now = ctx.currentTime;
    tone(ctx, { frequency: 523.25, startTime: now, duration: 0.14 });
    tone(ctx, { frequency: 783.99, startTime: now + 0.1, duration: 0.22 });
  },
  incorrect: (ctx) => {
    const now = ctx.currentTime;
    tone(ctx, { frequency: 220, startTime: now, duration: 0.18, type: 'sawtooth' });
    tone(ctx, { frequency: 164.81, startTime: now + 0.12, duration: 0.28, type: 'sawtooth' });
  },
  dailyDouble: (ctx) => {
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(ctx, { frequency, startTime: now + index * 0.09, duration: 0.16, type: 'triangle' });
    });
  },
  timeUp: (ctx) => {
    const now = ctx.currentTime;
    tone(ctx, { frequency: 440, startTime: now, duration: 0.1, type: 'square' });
    tone(ctx, { frequency: 440, startTime: now + 0.16, duration: 0.1, type: 'square' });
    tone(ctx, { frequency: 440, startTime: now + 0.32, duration: 0.2, type: 'square' });
  },
  gameOver: (ctx) => {
    const now = ctx.currentTime;
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(ctx, { frequency, startTime: now + index * 0.12, duration: 0.3, type: 'triangle' });
    });
  }
};

export const useSound = (enabled) => {
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === 'true');
  const warmedRef = useRef(false);

  useEffect(() => {
    if (!enabled || warmedRef.current) return undefined;
    const warmUp = () => {
      warmedRef.current = true;
      const ctx = getContext();
      if (ctx.state === 'suspended') ctx.resume();
    };
    window.addEventListener('pointerdown', warmUp, { once: true });
    window.addEventListener('keydown', warmUp, { once: true });
    return () => {
      window.removeEventListener('pointerdown', warmUp);
      window.removeEventListener('keydown', warmUp);
    };
  }, [enabled]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      localStorage.setItem(MUTE_KEY, String(next));
      return next;
    });
  }, []);

  const play = useCallback(
    (name) => {
      if (!enabled || muted) return;
      const voice = VOICES[name];
      if (!voice) return;
      const ctx = getContext();
      if (ctx.state === 'suspended') return;
      voice(ctx);
    },
    [enabled, muted]
  );

  return { muted, toggleMuted, play };
};
