/*
 * Sound for the print job, synthesised with Web Audio so it ships no files.
 *
 * Browsers only allow audio after a user gesture, so nothing here makes a
 * sound until enable() is called from a click. Every method is safe to call
 * while disabled; it simply does nothing.
 */

const NOISE_SECONDS = 2;

export class PrintAudio {
    private ctx: AudioContext | null = null;
    private master!: GainNode;
    private noise!: AudioBuffer;
    private stepper?: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
    private fan?: { gain: GainNode };
    enabled = false;

    /** Must be called from a user gesture (click / keydown). */
    async enable() {
        if (!this.ctx) this.build();
        await this.ctx!.resume();
        this.enabled = true;
        this.master.gain.setTargetAtTime(0.9, this.ctx!.currentTime, 0.05);
    }

    disable() {
        if (!this.ctx) return;
        this.enabled = false;
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }

    dispose() {
        this.ctx?.close().catch((error) => console.warn("PrintAudio: close failed", error));
        this.ctx = null;
        this.enabled = false;
    }

    private build() {
        const ctx = new AudioContext();
        this.ctx = ctx;

        // Master bus with a limiter so layered effects never clip.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.ratio.value = 12;
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(limiter).connect(ctx.destination);

        this.noise = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        // Stepper motor: a square wave whose pitch tracks axis speed.
        const osc = ctx.createOscillator();
        osc.type = "square";
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 3;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(filter).connect(gain).connect(this.master);
        osc.start();
        this.stepper = { osc, filter, gain };

        // Part-cooling fan: low filtered noise.
        const fanSrc = this.noiseSource(true);
        const fanFilter = ctx.createBiquadFilter();
        fanFilter.type = "lowpass";
        fanFilter.frequency.value = 420;
        const fanGain = ctx.createGain();
        fanGain.gain.value = 0;
        fanSrc.connect(fanFilter).connect(fanGain).connect(this.master);
        fanSrc.start();
        this.fan = { gain: fanGain };
    }

    private noiseSource(loop = false) {
        const src = this.ctx!.createBufferSource();
        src.buffer = this.noise;
        src.loop = loop;
        return src;
    }

    /** speed: 0 (still) .. 1 (fastest travel). Called every frame while printing. */
    setStepper(speed: number) {
        if (!this.enabled || !this.stepper || !this.ctx) return;
        const t = this.ctx.currentTime;
        const s = Math.min(1, Math.max(0, speed));
        this.stepper.osc.frequency.setTargetAtTime(160 + s * 1300, t, 0.03);
        this.stepper.filter.frequency.setTargetAtTime(300 + s * 1800, t, 0.03);
        this.stepper.gain.gain.setTargetAtTime(s * 0.022, t, 0.04);
    }

    setFan(level: number) {
        if (!this.enabled || !this.fan || !this.ctx) return;
        this.fan.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, level)) * 0.05, this.ctx.currentTime, 0.2);
    }

    /** Tool change: a short mechanical click. */
    click() {
        if (!this.enabled || !this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const src = this.noiseSource();
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 3800;
        bp.Q.value = 2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        src.connect(bp).connect(g).connect(this.master);
        src.start(t);
        src.stop(t + 0.05);
    }

    /**
     * The launch, scheduled to line up with the visual getaway:
     *   0.00-0.32s  burnout: revs climb, tyres screech
     *   0.32s       clutch drop, car moves
     *   ~0.75s      upshift
     *   1.00s+      car leaves frame: pitch drops (Doppler), pans right, fades
     */
    launch(burnout: number, exit: number) {
        if (!this.enabled || !this.ctx) return;
        const ctx = this.ctx;
        const t0 = ctx.currentTime + 0.01;
        const end = t0 + exit + 0.7;

        // Engine: three harmonics into soft clipping and an rpm-tracking low-pass.
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(2.4 * x);
        }
        shaper.curve = curve;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.Q.value = 1.2;
        const engineGain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        shaper.connect(lp).connect(engineGain).connect(pan).connect(this.master);

        const harmonics: [OscillatorType, number, number][] = [
            ["sawtooth", 1, 0.5],
            ["square", 2, 0.18],
            ["sawtooth", 3.02, 0.14],
        ];
        // rpm curve as fundamental frequency (Hz) at times relative to t0.
        const rpm: [number, number][] = [
            [0, 110],
            [burnout, 540],
            [burnout + 0.04, 400], // clutch drop bogs the engine for an instant
            [burnout + 0.42, 920],
            [burnout + 0.46, 640], // upshift
            [exit, 1000],
            [exit + 0.6, 690], // passing: Doppler drop
        ];
        for (const [type, mult, level] of harmonics) {
            const osc = ctx.createOscillator();
            osc.type = type;
            const g = ctx.createGain();
            g.gain.value = level;
            osc.connect(g).connect(shaper);
            osc.frequency.setValueAtTime(rpm[0][1] * mult, t0);
            for (const [at, hz] of rpm.slice(1)) osc.frequency.exponentialRampToValueAtTime(hz * mult, t0 + at);
            osc.start(t0);
            osc.stop(end);
        }
        lp.frequency.setValueAtTime(900, t0);
        lp.frequency.exponentialRampToValueAtTime(5200, t0 + exit);
        lp.frequency.exponentialRampToValueAtTime(1400, t0 + exit + 0.6);

        engineGain.gain.setValueAtTime(0.0001, t0);
        engineGain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.06);
        engineGain.gain.setValueAtTime(0.32, t0 + exit - 0.1);
        engineGain.gain.exponentialRampToValueAtTime(0.0001, t0 + exit + 0.65);
        pan.pan.setValueAtTime(0, t0 + burnout);
        pan.pan.linearRampToValueAtTime(0.85, t0 + exit + 0.4);

        // Tyre screech during the burnout: narrow noise bands with a wobble.
        for (const [freq, level] of [[2300, 0.16], [3400, 0.08]] as const) {
            const src = this.noiseSource();
            const bp = ctx.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.value = freq;
            bp.Q.value = 9;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(level, t0 + 0.06);
            g.gain.setValueAtTime(level, t0 + burnout);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + burnout + 0.35);
            src.connect(bp).connect(g).connect(this.master);
            src.start(t0);
            src.stop(t0 + burnout + 0.4);
        }

        // Air rush as it passes.
        const air = this.noiseSource();
        const airLp = ctx.createBiquadFilter();
        airLp.type = "lowpass";
        airLp.frequency.setValueAtTime(600, t0 + burnout);
        airLp.frequency.exponentialRampToValueAtTime(2600, t0 + exit);
        airLp.frequency.exponentialRampToValueAtTime(300, t0 + exit + 0.6);
        const airGain = ctx.createGain();
        airGain.gain.setValueAtTime(0.0001, t0 + burnout);
        airGain.gain.exponentialRampToValueAtTime(0.14, t0 + exit);
        airGain.gain.exponentialRampToValueAtTime(0.0001, t0 + exit + 0.6);
        const airPan = ctx.createStereoPanner();
        airPan.pan.setValueAtTime(0, t0 + burnout);
        airPan.pan.linearRampToValueAtTime(0.9, t0 + exit + 0.5);
        air.connect(airLp).connect(airGain).connect(airPan).connect(this.master);
        air.start(t0 + burnout);
        air.stop(end);
    }
}
