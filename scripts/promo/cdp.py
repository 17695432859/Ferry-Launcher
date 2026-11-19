"""驱动真实 Ferry Launcher（WebView2）并内录画面的最小 CDP 客户端。

用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 打开调试端口后，
通过 Chrome DevTools Protocol 做两件事：

1. `Input.dispatchMouseEvent` 在页面内部派发真实输入 —— 不碰系统鼠标，
   不会点到用户正在用的窗口上，hover / focus / :active 状态都是真的。
2. `Page.startScreencast` 拿合成器输出的帧 —— 也就是这个窗口真正画出来的画面，
   包含 backdrop-filter 毛玻璃效果，且窗口被遮挡也照样能录。
"""
import base64
import json
import os
import threading
import time
import urllib.request

import websocket


class CDP:
    def __init__(self, port=9222):
        self.url = self._find_page(port)
        self.ws = websocket.create_connection(self.url, timeout=30, max_size=64 * 1024 * 1024)
        self._id = 0
        self._lock = threading.Lock()
        self._pending = {}
        self._handlers = {}
        self._closed = False
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    @staticmethod
    def _find_page(port, timeout=30.0):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
                    targets = json.load(r)
                for target in targets:
                    if target.get("type") == "page" and target.get("webSocketDebuggerUrl"):
                        return target["webSocketDebuggerUrl"]
            except Exception as error:  # 端口还没起来
                last = error
            time.sleep(0.4)
        raise RuntimeError(f"连不上 CDP 调试端口 {port}: {last}")

    def _read_loop(self):
        while not self._closed:
            try:
                raw = self.ws.recv()
            except Exception:
                break
            if not raw:
                continue
            message = json.loads(raw)
            if "id" in message:
                with self._lock:
                    slot = self._pending.pop(message["id"], None)
                if slot:
                    slot[1] = message
                    slot[0].set()
                continue
            handler = self._handlers.get(message.get("method"))
            if handler:
                try:
                    handler(message.get("params") or {})
                except Exception as error:
                    print("事件处理出错", message.get("method"), error)

    def on(self, method, handler):
        self._handlers[method] = handler

    def send_async(self, method, params=None):
        """只发不等回复。screencast 的 ack 必须在读线程里发，否则会自己等自己。"""
        with self._lock:
            self._id += 1
            request_id = self._id
        self.ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        return request_id

    def send(self, method, params=None, timeout=30):
        self._id += 1
        request_id = self._id
        done = threading.Event()
        slot = [done, None]
        with self._lock:
            self._pending[request_id] = slot
        self.ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        if not done.wait(timeout):
            raise TimeoutError(f"{method} 超时")
        reply = slot[1] or {}
        if "error" in reply:
            raise RuntimeError(f"{method} 失败: {reply['error']}")
        return reply.get("result", {})

    def js(self, expression, timeout=30):
        result = self.send(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
            timeout=timeout,
        )
        return result.get("result", {}).get("value")

    def close(self):
        self._closed = True
        try:
            self.ws.close()
        except Exception:
            pass


class Recorder:
    """把 screencast 的帧落盘，同时记录每帧的时间戳，后面按时间轴还原成视频。"""

    def __init__(self, cdp, out_dir, quality=92, max_width=1280):
        self.cdp = cdp
        self.out_dir = out_dir
        self.quality = quality
        self.max_width = max_width
        self.frames = []  # (相对时间秒, 文件名)
        self._start = None
        self._count = 0
        os.makedirs(out_dir, exist_ok=True)
        cdp.on("Page.screencastFrame", self._on_frame)

    def _on_frame(self, params):
        session = params.get("sessionId")
        data = params.get("data")
        now = time.monotonic()
        if self._start is None:
            self._start = now
        if data:
            name = f"{self._count:05d}.jpg"
            with open(os.path.join(self.out_dir, name), "wb") as handle:
                handle.write(base64.b64decode(data))
            self.frames.append((now - self._start, name))
            self._count += 1
        # 不 ack 就收不到下一帧
        self.cdp.send_async("Page.screencastFrameAck", {"sessionId": session})

    def start(self):
        self.cdp.send("Page.enable")
        self.cdp.send(
            "Page.startScreencast",
            {"format": "jpeg", "quality": self.quality, "maxWidth": self.max_width,
             "maxHeight": 2000, "everyNthFrame": 1},
        )

    def stop(self):
        try:
            self.cdp.send("Page.stopScreencast", timeout=10)
        except Exception:
            pass
        return self.frames


def launch(exe, data_dir, port=9222, extra_env=None):
    env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy")}
    env.pop("NO_PROXY", None)
    env["FERRY_DATA_DIR"] = data_dir
    # 关键：窗口被别的窗口挡住时 Chromium 会判定 occluded 并停掉 rAF / 合成，
    # 那样录出来的画面是死的（连背景视差都不动）。这几个开关把降频关掉，
    # 这样窗口放在后面也能正常渲染、正常出帧。
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = " ".join([
        f"--remote-debugging-port={port}",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=CalculateNativeWinOcclusion",
    ])
    if extra_env:
        env.update(extra_env)
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    return _spawn(exe, env, flags)


def _spawn(exe, env, flags):
    import subprocess

    return subprocess.Popen([exe], env=env, cwd=os.path.dirname(exe), creationflags=flags)
