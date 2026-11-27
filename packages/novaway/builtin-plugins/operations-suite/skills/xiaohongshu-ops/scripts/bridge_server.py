"""XHS Extension Bridge Server

Extension 连接到这里（WebSocket），CLI 命令通过同一端口发送（role=cli），
Bridge 将命令路由给 Extension 并把结果返回给 CLI。

同时提供 HTTP 端点供外部应用（如 Electron WebView）注入 cookie。

启动方式：
    python scripts/bridge_server.py

端口：9333（可通过 --port 覆盖）
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import uuid
from http.server import BaseHTTPRequestHandler
from typing import Any

import websockets
from websockets.server import ServerConnection

logger = logging.getLogger("xhs-bridge")


class BridgeServer:
    def __init__(self) -> None:
        self._extension_ws: ServerConnection | None = None
        self._pending: dict[str, asyncio.Future[Any]] = {}

    async def handle(self, ws: ServerConnection) -> None:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning("握手超时或失败: %s", e)
            return

        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        role = msg.get("role")
        if role == "extension":
            await self._handle_extension(ws)
        elif role == "cli":
            await self._handle_cli(ws, msg)
        else:
            logger.warning("未知 role: %s", role)

    # ─── Extension 端（长连接） ───────────────────────────────────────

    async def _handle_extension(self, ws: ServerConnection) -> None:
        logger.info("Extension 已连接")
        self._extension_ws = ws
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                msg_id = msg.get("id")
                if msg_id and msg_id in self._pending:
                    future = self._pending.pop(msg_id)
                    if not future.done():
                        future.set_result(msg)
        finally:
            self._extension_ws = None
            logger.info("Extension 已断开")
            # 唤醒所有等待中的 CLI 请求并报错
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(ConnectionError("Extension 断开连接"))
            self._pending.clear()

    # ─── CLI 端（短连接，发一条命令，收一条回复） ─────────────────────

    async def _handle_cli(self, ws: ServerConnection, msg: dict) -> None:
        # 特殊命令：查询 server/extension 状态，无需转发
        if msg.get("method") == "ping_server":
            await ws.send(json.dumps({
                "result": {"extension_connected": self._extension_ws is not None}
            }))
            return

        if not self._extension_ws:
            await ws.send(json.dumps({"error": "Extension 未连接，请确认浏览器已安装并启用 XHS Bridge 扩展"}))
            return

        msg_id = str(uuid.uuid4())
        msg["id"] = msg_id

        loop = asyncio.get_event_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending[msg_id] = future

        await self._extension_ws.send(json.dumps(msg))

        try:
            result = await asyncio.wait_for(future, timeout=90.0)
            await ws.send(json.dumps(result))
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            await ws.send(json.dumps({"error": "命令执行超时（90s）"}))
        except ConnectionError as e:
            await ws.send(json.dumps({"error": str(e)}))

    # ─── HTTP API（供外部应用注入 cookie） ──────────────────────────

    async def inject_cookies_http(self, cookies: list[dict]) -> dict:
        """通过 WebSocket 将 cookie 注入到 Extension。"""
        if not self._extension_ws:
            return {"error": "Extension 未连接"}

        msg_id = str(uuid.uuid4())
        msg = {"role": "cli", "method": "set_cookies", "params": {"cookies": cookies}, "id": msg_id}

        loop = asyncio.get_event_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending[msg_id] = future

        await self._extension_ws.send(json.dumps(msg))

        try:
            result = await asyncio.wait_for(future, timeout=30.0)
            return result.get("result", result)
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            return {"error": "注入 cookie 超时"}
        except ConnectionError as e:
            return {"error": str(e)}


# ─── HTTP 请求处理器 ─────────────────────────────────────────────

_bridge_server: BridgeServer | None = None


class CookieHTTPHandler(BaseHTTPRequestHandler):
    """处理 HTTP POST /api/cookies 请求。"""

    def do_POST(self) -> None:
        if self.path != "/api/cookies":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "not found"}')
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "empty body"}')
            return

        body = self.rfile.read(content_length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "invalid json"}')
            return

        # 标准化格式
        if isinstance(data, list):
            cookies = data
        elif isinstance(data, dict):
            cookies = data.get("cookies") or data.get("cookie_list") or [data]
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "invalid format"}')
            return

        # 验证
        valid = [c for c in cookies if isinstance(c, dict) and "name" in c and "value" in c]
        if not valid:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "no valid cookies"}')
            return

        # 异步注入
        if _bridge_server:
            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(_bridge_server.inject_cookies_http(valid))
            finally:
                loop.close()
        else:
            result = {"error": "bridge server 未初始化"}

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def do_OPTIONS(self) -> None:
        """处理 CORS 预检请求。"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        logger.debug("HTTP: %s", format % args)


def _run_http_server(port: int) -> None:
    """在单独线程中运行 HTTP 服务器。"""
    from http.server import HTTPServer

    server = HTTPServer(("127.0.0.1", port), CookieHTTPHandler)
    logger.info("HTTP API 已启动: http://127.0.0.1:%d/api/cookies", port)
    server.serve_forever()


async def main(ws_port: int, http_port: int) -> None:
    global _bridge_server

    _bridge_server = BridgeServer()

    # 启动 HTTP 服务器（单独线程）
    import threading
    http_thread = threading.Thread(target=_run_http_server, args=(http_port,), daemon=True)
    http_thread.start()

    # 启动 WebSocket 服务器
    async with websockets.serve(_bridge_server.handle, "localhost", ws_port):
        logger.info("Bridge server 已启动: ws://localhost:%d", ws_port)
        logger.info("等待浏览器扩展连接...")
        await asyncio.Future()  # 永久运行


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="XHS Extension Bridge Server")
    parser.add_argument("--port", type=int, default=9333, help="WebSocket 监听端口（默认 9333）")
    parser.add_argument("--http-port", type=int, default=9334, help="HTTP API 监听端口（默认 9334）")
    args = parser.parse_args()

    asyncio.run(main(args.port, args.http_port))
