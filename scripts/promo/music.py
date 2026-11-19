"""给宣传片合成一段原创配乐（无版权问题，纯 numpy 合成）。

风格对标参考视频：干净的电子底子、铺底和声 + 拨弦琶音 + 轻鼓组，
节奏不抢戏，适合 UI 展示。段落边界按 driver 打的时间点对齐。
"""
import json
import os
import sys
import wave

import numpy as np

SR = 44100
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "promo", "music.wav")

rng = np.random.default_rng(20261119)


def midi(note):
    return 440.0 * 2 ** ((note - 69) / 12.0)


def t_axis(seconds):
    return np.arange(int(SR * seconds)) / SR


def env_ad(n, attack, decay, curve=2.0):
    """attack-decay 包络，单位秒。"""
    attack_n = max(1, int(attack * SR))
    decay_n = max(1, n - attack_n)
    a = np.linspace(0, 1, attack_n) ** 0.6
    d = np.exp(-np.linspace(0, curve * 3, decay_n))
    return np.concatenate([a, d])[:n]


def saw(freq, n, phase=0.0):
    t = np.arange(n) / SR
    return 2.0 * ((t * freq + phase) % 1.0) - 1.0


def sine(freq, n, phase=0.0):
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t + phase)


def lowpass(signal, cutoff, resonance=0.0):
    """一阶 IIR 低通。用指数核做卷积等价实现——纯 Python 逐样本循环太慢。"""
    alpha = 1 - np.exp(-2 * np.pi * cutoff / SR)
    if alpha >= 0.999:
        return signal
    taps = int(np.log(1e-5) / np.log(max(1e-6, 1 - alpha))) + 1
    taps = min(max(taps, 2), 4000)
    kernel = alpha * (1 - alpha) ** np.arange(taps)
    out = np.convolve(signal, kernel, mode="full")[:len(signal)]
    if resonance > 0:
        out = out + resonance * (signal - out)
    return out


def highpass(signal, cutoff):
    return signal - lowpass(signal, cutoff)


def reverb(signal, mix=0.28, decay=0.82, length=1.8):
    """用指数衰减噪声当脉冲响应，FFT 卷积做混响。"""
    n_ir = int(SR * length)
    t = np.arange(n_ir) / SR
    ir = rng.normal(0, 1, n_ir) * np.exp(-t * (6.0 * (1.0 - decay) + 2.2))
    ir = lowpass(ir, 5200)
    ir[: int(SR * 0.012)] *= np.linspace(0, 1, int(SR * 0.012))
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    size = len(signal) + n_ir
    spectrum = np.fft.rfft(signal, size) * np.fft.rfft(ir, size)
    wet = np.fft.irfft(spectrum, size)[: len(signal)]
    return signal * (1 - mix) + wet * mix * 1.6


def pad_chord(notes, seconds, gain=0.20):
    n = int(SR * seconds)
    out = np.zeros(n)
    for note in notes:
        freq = midi(note)
        for detune in (-0.006, 0.0, 0.006):
            voice = saw(freq * (1 + detune), n, rng.random())
            out += voice
    out /= (len(notes) * 3)
    out = lowpass(out, 2400)
    # 慢起慢落，换和弦时不留缝
    attack = int(0.5 * SR)
    release = int(0.9 * SR)
    envelope = np.ones(n)
    envelope[:attack] = np.linspace(0, 1, attack) ** 1.5
    envelope[-release:] = np.linspace(1, 0, release) ** 1.5
    return out * envelope * gain


def pluck(note, seconds, gain=0.22, bright=0.5):
    n = int(SR * seconds)
    freq = midi(note)
    body = sine(freq, n) * 0.7 + sine(freq * 2, n) * 0.2 * bright + saw(freq, n) * 0.12 * bright
    return body * env_ad(n, 0.004, seconds, curve=2.6) * gain


def kick(seconds=0.42, gain=0.85):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    freq = 118 * np.exp(-t * 26) + 44
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t * 7.5)
    click = rng.normal(0, 1, n) * np.exp(-t * 220) * 0.25
    return (body + click) * gain


def hat(seconds=0.09, gain=0.16, open_=False):
    n = int(SR * (seconds * (3.2 if open_ else 1)))
    noise = rng.normal(0, 1, n)
    noise = highpass(noise, 7000)
    return noise * np.exp(-np.arange(n) / SR * (18 if open_ else 55)) * gain


def clap(seconds=0.24, gain=0.30):
    n = int(SR * seconds)
    noise = rng.normal(0, 1, n)
    noise = highpass(noise, 1400)
    envelope = np.exp(-np.arange(n) / SR * 22)
    # 三次短促叠加，像拍手
    for offset in (0.0, 0.011, 0.023):
        start = int(offset * SR)
        envelope[start:] += np.exp(-np.arange(n - start) / SR * 26) * 0.6
    return noise * envelope * gain * 0.5


def whoosh(seconds=1.1, gain=0.20):
    n = int(SR * seconds)
    noise = rng.normal(0, 1, n)
    sweep = lowpass(noise, 900)
    envelope = np.linspace(0, 1, n) ** 2.2
    envelope[-int(n * 0.35):] *= np.linspace(1, 0, int(n * 0.35))
    return sweep * envelope * gain


def impact(seconds=1.4, gain=0.5):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    low = np.sin(2 * np.pi * (70 * np.exp(-t * 5) + 32) * t) * np.exp(-t * 3.2)
    return low * gain


class Track:
    def __init__(self, seconds):
        self.n = int(SR * seconds)
        self.dry = np.zeros(self.n)
        self.send = np.zeros(self.n)

    def add(self, start, signal, gain=1.0, wet=0.0):
        index = int(start * SR)
        if index >= self.n:
            return
        stop = min(index + len(signal), self.n)
        span = stop - index
        self.dry[index:stop] += signal[:span] * gain
        if wet:
            self.send[index:stop] += signal[:span] * gain * wet


def build(total=72.0):
    marks = json.load(open(os.path.join(ROOT, "promo", "marks.json"), encoding="utf-8"))["marks"]
    at = {item["label"]: item["t"] for item in marks}
    track = Track(total)

    bpm = 104.0
    beat = 60.0 / bpm
    bar = beat * 4

    # 和声：Am9 → Fmaj7 → Cmaj7 → G6
    progression = [
        [45, 48, 52, 55, 59],   # Am9
        [41, 45, 48, 52, 55],   # Fmaj7
        [48, 52, 55, 59, 62],   # Cmaj7
        [43, 47, 50, 52, 55],   # G6
    ]
    arp_scale = [69, 72, 76, 79, 81, 84, 88]

    # —— 铺底：整段铺满，音量按段落起伏 ——
    section_gain = [
        (0.0, 0.55), (at["cards"], 0.8), (at["content"], 0.9),
        (at["netplay"], 1.0), (at["settings"], 0.95),
        (at["download"], 0.85), (at["finale"], 0.7), (total, 0.0),
    ]

    def gain_at(time_point):
        for index in range(len(section_gain) - 1):
            start, value = section_gain[index]
            if start <= time_point < section_gain[index + 1][0]:
                return value
        return section_gain[-1][1]

    cursor = 0.0
    index = 0
    while cursor < total - 0.1:
        chord = progression[index % len(progression)]
        level = gain_at(cursor)
        track.add(cursor, pad_chord([n + 12 for n in chord], bar * 1.02, gain=0.10), gain=level, wet=0.45)
        cursor += bar
        index += 1

    # —— 低音：从 cards 开始，八分音符 ——
    cursor = at["cards"]
    bar_index = 0
    while cursor < at["finale"]:
        chord = progression[int(bar_index) % len(progression)]
        root = chord[0] - 12
        level = 0.9 if cursor > at["content"] else 0.7
        for offset in (0.0, beat * 0.75):
            n = int(SR * beat * 0.5)
            body = sine(midi(root), n) * 0.8 + saw(midi(root), n) * 0.18
            body = lowpass(body, 240) * env_ad(n, 0.01, beat * 0.5, curve=1.6)
            track.add(cursor + offset, body, gain=0.16 * level)
        cursor += beat
        bar_index += 0.25

    # —— 琶音：十六分音符，主歌之后进 ——
    cursor = at["content"]
    step = beat / 4
    index = 0
    while cursor < at["finale"]:
        note = arp_scale[index % len(arp_scale)]
        level = 1.0 if cursor > at["netplay"] else 0.7
        if index % 8 == 7:
            note += 12
        track.add(cursor, pluck(note, step * 2.4, gain=0.62), gain=level, wet=0.55)
        cursor += step
        index += 1

    # —— 鼓组 ——
    cursor = at["cards"]
    index = 0
    while cursor < at["finale"]:
        position = index % 8
        heavy = cursor >= at["content"]
        if position in (0, 3, 6) and heavy:
            track.add(cursor, kick(), gain=0.52)
        elif position == 0:
            track.add(cursor, kick(), gain=0.34)
        track.add(cursor, hat(gain=0.10 if position % 2 else 0.17))
        if heavy and position in (2, 6):
            track.add(cursor, clap(), gain=0.55, wet=0.35)
        cursor += beat / 2
        index += 1

    # —— 段落转场：气流 + 低频落点 ——
    for label in ("cards", "content", "accounts", "netplay", "settings", "download", "finale"):
        moment = at[label]
        track.add(moment - 0.55, whoosh(), gain=0.30)
        track.add(moment, impact(), gain=0.32)

    # —— 收尾：长尾和弦 ——
    tail_start = at["finale"]
    track.add(tail_start, pad_chord([57, 64, 69, 72, 76], total - tail_start, gain=0.18),
              gain=1.0, wet=0.7)

    # —— 混音 ——
    wet = reverb(track.send, mix=0.9, decay=0.78)
    mix = track.dry + wet * 0.55
    # 三段 EQ：压低轰头的低频、抬起中频主体、高频只留一点空气感
    low_band = lowpass(mix, 200)
    mid_band = lowpass(mix, 2600) - low_band
    high_band = mix - lowpass(mix, 2600)
    mix = low_band * 0.80 + mid_band * 1.00 + high_band * 2.20
    # 整体渐入渐出
    fade_in = int(SR * 0.8)
    mix[:fade_in] *= np.linspace(0, 1, fade_in) ** 0.7
    fade_out = int(SR * 2.4)
    mix[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.3
    # 软限幅
    peak = np.max(np.abs(mix)) or 1.0
    mix = mix / peak * 1.15
    mix = np.tanh(mix * 1.1) * 0.92
    return mix


def write_wav(path, signal):
    data = (np.clip(signal, -1, 1) * 32767).astype("<i2")
    stereo = np.stack([data, data], axis=1).reshape(-1)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(stereo.tobytes())


def main():
    total = float(sys.argv[1]) if len(sys.argv) > 1 else 72.0
    signal = build(total)
    write_wav(OUT, signal)
    rms = float(np.sqrt(np.mean(signal ** 2)))
    print(f"输出 {OUT}  {len(signal)/SR:.1f}s  RMS {rms:.3f}  峰值 {np.max(np.abs(signal)):.3f}")


if __name__ == "__main__":
    main()
