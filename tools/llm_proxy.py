"""
本地大模型代理（仅标准库）：解决静态页直连大模型 API 的 CORS 问题。

用法：
    D:\\python.exe tools\\llm_proxy.py
    D:\\python.exe tools\\llm_proxy.py --port 8787 --target https://open.bigmodel.cn/api/paas/v4

然后把站点「大模型设置」里的 Base URL 改成 http://127.0.0.1:8787/v1
API Key 仍然填你自己的，Key 只在本机内存与请求头里，不会写盘。

说明：
- 只监听 127.0.0.1，局域网/外网访问不到；
- 透传 Authorization / Content-Type，支持 SSE 流式；
- 仅用于本地调试。上线后请用 Cloudflare Worker / 云函数做同样的转发。
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    target = "https://open.bigmodel.cn/api/paas/v4"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            body = json.dumps({"ok": True, "target": self.target}).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        path = self.path
        if path.startswith("/v1"):
            path = path[3:]
        url = self.target.rstrip("/") + path

        req = urllib.request.Request(url, data=raw, method="POST")
        req.add_header("Content-Type", self.headers.get("Content-Type") or "application/json")
        if self.headers.get("Authorization"):
            req.add_header("Authorization", self.headers.get("Authorization"))
        if self.headers.get("Accept"):
            req.add_header("Accept", self.headers.get("Accept"))

        try:
            upstream = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self._cors()
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        except Exception as e:  # 网络不可达等
            body = json.dumps({"error": {"message": str(e)}}).encode()
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(upstream.status)
        self._cors()
        ctype = upstream.headers.get("Content-Type", "application/json")
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        streaming = "event-stream" in ctype
        if streaming:
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            while True:
                chunk = upstream.read(1024)
                if not chunk:
                    break
                self.wfile.write(("%X\r\n" % len(chunk)).encode() + chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        else:
            body = upstream.read()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--target", default="https://open.bigmodel.cn/api/paas/v4")
    args = ap.parse_args()
    Handler.target = args.target.rstrip("/")
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("代理已启动：http://127.0.0.1:%d/v1  ->  %s" % (args.port, Handler.target))
    print("站点 Base URL 填：http://127.0.0.1:%d/v1" % args.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
