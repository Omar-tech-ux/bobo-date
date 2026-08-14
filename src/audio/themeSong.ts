export type ThemeMood = "tender" | "bright" | "dreamy" | "cinema";
export type InteractionSound =
  | "tap"
  | "soft"
  | "no"
  | "yes"
  | "door"
  | "page"
  | "select"
  | "confirm"
  | "letter";

const melody = [
  659.25,
  null,
  783.99,
  880,
  783.99,
  null,
  659.25,
  587.33,
  523.25,
  null,
  659.25,
  783.99,
  659.25,
  null,
  587.33,
  null,
  659.25,
  null,
  783.99,
  987.77,
  880,
  null,
  783.99,
  659.25,
  587.33,
  null,
  659.25,
  783.99,
  659.25,
  587.33,
  523.25,
  null,
] as const;

const harmony = [261.63, 220, 174.61, 196] as const;
const bass = [130.81, 110, 87.31, 98] as const;

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor() {
  const audioWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext || audioWindow.webkitAudioContext;
}

export class ThemeSongEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private scheduler?: number;
  private moodTimer?: number;
  private nextNoteTime = 0;
  private step = 0;
  private mood: ThemeMood = "tender";
  private muted = false;
  private pausedForVideo = false;
  private pageHidden = false;
  private readonly volume = 0.3;

  async start() {
    if (this.context) {
      await this.context.resume();
      this.applyVolume();
      return true;
    }

    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) return false;

    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(this.context.destination);
    this.nextNoteTime = this.context.currentTime + 0.08;
    await this.context.resume();
    this.applyVolume();
    this.scheduleAhead();
    this.scheduler = window.setInterval(() => this.scheduleAhead(), 80);
    return true;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyVolume();
  }

  setPausedForVideo(paused: boolean) {
    this.pausedForVideo = paused;
    this.applyVolume(paused ? 0.05 : 0.18);
  }

  setPageHidden(hidden: boolean) {
    this.pageHidden = hidden;
    this.applyVolume(hidden ? 0.04 : 0.18);
  }

  setMood(mood: ThemeMood) {
    if (mood === this.mood) return;
    if (!this.context || !this.master) {
      this.mood = mood;
      return;
    }

    this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.08);
    window.clearTimeout(this.moodTimer);
    this.moodTimer = window.setTimeout(() => {
      this.mood = mood;
      this.applyVolume(0.18);
    }, 220);
  }

  playInteraction(sound: InteractionSound) {
    if (
      !this.context ||
      !this.master ||
      this.muted ||
      this.pausedForVideo ||
      this.pageHidden
    )
      return;
    const now = this.context.currentTime + 0.008;
    const patterns: Record<
      InteractionSound,
      Array<[number, number, number]>
    > = {
      tap: [[783.99, 0, 0.055]],
      soft: [[659.25, 0, 0.075]],
      no: [
        [659.25, 0, 0.1],
        [523.25, 0.085, 0.14],
      ],
      yes: [
        [523.25, 0, 0.16],
        [659.25, 0.08, 0.18],
        [783.99, 0.16, 0.22],
        [1046.5, 0.25, 0.34],
      ],
      door: [
        [392, 0, 0.18],
        [587.33, 0.09, 0.22],
        [783.99, 0.19, 0.3],
      ],
      page: [
        [880, 0, 0.065],
        [987.77, 0.055, 0.1],
      ],
      select: [
        [698.46, 0, 0.08],
        [880, 0.07, 0.14],
      ],
      confirm: [
        [523.25, 0, 0.14],
        [659.25, 0.07, 0.17],
        [783.99, 0.14, 0.26],
      ],
      letter: [
        [523.25, 0, 0.2],
        [659.25, 0.1, 0.24],
        [880, 0.21, 0.3],
        [1046.5, 0.34, 0.45],
      ],
    };
    const level = sound === "tap" || sound === "soft" ? 0.032 : 0.052;
    patterns[sound].forEach(([frequency, delay, duration]) => {
      this.playBell(frequency, now + delay, duration, level);
    });
  }

  dispose() {
    window.clearInterval(this.scheduler);
    window.clearTimeout(this.moodTimer);
    if (this.context) void this.context.close();
    this.context = undefined;
    this.master = undefined;
  }

  private applyVolume(fade = 0.15) {
    if (!this.context || !this.master) return;
    const audible = !this.muted && !this.pausedForVideo && !this.pageHidden;
    this.master.gain.setTargetAtTime(
      audible ? this.volume : 0.0001,
      this.context.currentTime,
      fade,
    );
  }

  private scheduleAhead() {
    if (!this.context || !this.master) return;
    const beat = 60 / 75 / 2;
    while (this.nextNoteTime < this.context.currentTime + 0.45) {
      this.scheduleStep(this.step, this.nextNoteTime, beat);
      this.step = (this.step + 1) % melody.length;
      this.nextNoteTime += beat;
    }
  }

  private scheduleStep(step: number, time: number, beat: number) {
    const note = melody[step];
    const sparseCinema = this.mood === "cinema" && step % 2 === 1;
    if (note && !sparseCinema) {
      const lift = this.mood === "bright" && step >= 16 ? 1.5 : 1;
      this.playBell(
        note * lift,
        time,
        beat * 1.65,
        this.mood === "cinema" ? 0.035 : 0.07,
      );
    }

    if (step % 8 === 0) {
      const chordIndex = Math.floor(step / 8);
      const root = harmony[chordIndex];
      this.playPad(root, time, beat * 7.5);
      this.playPad(root * 1.5, time + 0.03, beat * 7.2);
    }

    if (this.mood === "bright" && step % 4 === 0) {
      this.playSoftPulse(bass[Math.floor(step / 8)], time, beat * 2.8);
    }
  }

  private playBell(
    frequency: number,
    time: number,
    duration: number,
    level: number,
  ) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const shimmer = this.context.createOscillator();
    const gain = this.context.createGain();
    const shimmerGain = this.context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    shimmer.type = "triangle";
    shimmer.frequency.setValueAtTime(frequency * 2, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    shimmerGain.gain.setValueAtTime(0.0001, time);
    shimmerGain.gain.exponentialRampToValueAtTime(level * 0.18, time + 0.012);
    shimmerGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + duration * 0.55,
    );

    oscillator.connect(gain).connect(this.master);
    shimmer.connect(shimmerGain).connect(this.master);
    oscillator.start(time);
    shimmer.start(time);
    oscillator.stop(time + duration + 0.04);
    shimmer.stop(time + duration + 0.04);
  }

  private playPad(frequency: number, time: number, duration: number) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(
      this.mood === "cinema" ? 0.014 : 0.025,
      time + 0.3,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.05);
  }

  private playSoftPulse(frequency: number, time: number, duration: number) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.028, time + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.05);
  }
}
