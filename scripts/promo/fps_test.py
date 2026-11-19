"""测一下 screencast 的实际帧率，决定能不能直接用。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, Recorder, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")
OUT = os.path.join(ROOT, "promo", "frames-test")


def main():
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()
    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"width": 1600, "height": 941}})
    time.sleep(1.2)
    rec = Recorder(cdp, OUT)
    rec.start()
    time.sleep(1.0)
    # 制造连续动画：鼠标缓慢横移，触发 hover 与背景视差
    start = time.monotonic()
    while time.monotonic() - start < 6:
        t = time.monotonic() - start
        x = 400 + int(300 * t / 6)
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": 177, "button": "none"})
        time.sleep(0.016)
    rec.stop()
    frames = rec.frames
    span = frames[-1][0] - frames[0][0] if len(frames) > 1 else 0
    print(f"帧数 {len(frames)}  跨度 {span:.2f}s  平均 {len(frames)/max(span,0.001):.1f} fps")
    sizes = [os.path.getsize(os.path.join(OUT, n)) for _, n in frames[:20]]
    print("前 20 帧平均大小", sum(sizes) // max(len(sizes), 1) // 1024, "KB")
    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
