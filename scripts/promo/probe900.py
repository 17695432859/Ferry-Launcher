"""在 1600x900 的最终尺寸下重新量坐标（之前量的是 941 高，差一点就点空）。"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402
from take import DATA, EXE, ROOT, W, H, find_hwnd, fit_client  # noqa: E402

DUMP = """
(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 34);
    if (!text) continue;
    out.push([Math.round(r.left + r.width/2), Math.round(r.top + r.height/2), text]);
  }
  return out;
})()
"""


def click(cdp, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none"})
    time.sleep(0.04)
    cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    time.sleep(0.05)
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
    time.sleep(0.9)


def main():
    proc = launch(EXE, DATA)
    time.sleep(6.5)
    cdp = CDP()
    hwnd = find_hwnd(proc.pid)
    left, top, width, height = fit_client(hwnd, W, H)
    print(f"客户区 {width}x{height} @ ({left},{top})  视口",
          cdp.js("JSON.stringify([innerWidth, innerHeight])"))
    time.sleep(1.0)

    print("\n-- 启动页 --")
    for x, y, text in cdp.js(DUMP):
        print(f"{x:5d},{y:4d} {text!r}")

    # 试着点「内容」，看 tab 到底在哪
    for y in (140, 136, 144):
        click(cdp, 580, y)
        state = cdp.js("document.body.innerText.slice(0, 200).replace(/\\n/g,' | ')")
        print(f"点 (580,{y}) 后正文开头: {state[:120]}")

    print("\n-- 内容页 --")
    for x, y, text in cdp.js(DUMP)[:30]:
        print(f"{x:5d},{y:4d} {text!r}")

    print("\n-- 下载页（等 7 秒）--")
    click(cdp, 84, 153)
    time.sleep(7)
    body = cdp.js("document.body.innerText")
    print("正文长度", len(body))
    print(body[:400].replace("\n", " | "))

    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
