from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

import httpx

from rizhiyi_mcp.sse_client import _parse_sse_block, request_sse
from rizhiyi_mcp.types import HttpClientConfig


def _iter_lines_from_chunks(chunks: list[str]):
    """按 ``httpx`` ``aiter_lines()`` 的语义把任意字节分片切成"行"。

    关键点：分片边界不等于行边界——不完整的行必须留在缓冲区里，
    直到换行到达才产出一行。这样就能用「分片」构造出跨分片的事件。
    """
    buffer = ""
    for chunk in chunks:
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            yield line.rstrip("\r")
    if buffer:
        yield buffer.rstrip("\r")


class _FakeResponse:
    status_code = 200
    request = None

    def __init__(self, chunks: list[str]) -> None:
        self._chunks = chunks

    async def aiter_lines(self):
        for line in _iter_lines_from_chunks(self._chunks):
            yield line


class _FakeStreamContext:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeResponse:
        return self._response

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _FakeAsyncClient:
    chunks: list[str] = []

    def __init__(self, **kwargs: object) -> None:
        pass

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    def stream(self, method: str, url: str, headers=None, content=None) -> _FakeStreamContext:
        return _FakeStreamContext(_FakeResponse(type(self).chunks))


class _FakeTransport:
    def __init__(self, **kwargs: object) -> None:
        pass


class SseBlockParseTestCase(unittest.TestCase):
    """锁住「事件只在空行处成型，多行 data 拼接完整」这一语义。"""

    def test_multi_data_lines_are_joined(self) -> None:
        events = _parse_sse_block(
            [
                "event: STEP_OUTPUT",
                'data: {"id": "s1",',
                'data: "content": "x"}',
            ]
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event, "STEP_OUTPUT")
        self.assertEqual(events[0].data, '{"id": "s1",\n"content": "x"}')

    def test_incomplete_block_yields_no_event(self) -> None:
        # 只有 event 名、还没有任何 data 行时，不得成型为事件
        self.assertEqual(_parse_sse_block(["event: STEP_OUTPUT"]), [])
        # 只有 data、没有 event 名时同样不成型（与原实现一致）
        self.assertEqual(_parse_sse_block(["data: orphan"]), [])
        # 注释行被忽略
        self.assertEqual(_parse_sse_block([": keep-alive"]), [])

    def test_second_event_line_flushes_pending_event(self) -> None:
        """隐式事件边界：同块内出现第二个 event: 行时，先产出前一个 pending 事件。

        与 TS ``SseParser.consumeLine`` 第一个分支逐条对齐——旧实现是「同块内
        后一个 event 覆盖前一个」，最终只产出 1 个事件。
        """
        events = _parse_sse_block(["event: A", "data: 1", "event: B", "data: 2"])
        self.assertEqual(
            [(event.event, event.data) for event in events],
            [("A", "1"), ("B", "2")],
        )

    def test_orphan_data_line_is_dropped_without_leaking(self) -> None:
        # 有 data: 无 event: 的孤儿行必须丢弃，且不得泄漏到后续事件
        events = _parse_sse_block(["data: orphan", "event: X", "data: real"])
        self.assertEqual([(event.event, event.data) for event in events], [("X", "real")])
        # 整个块都是孤儿行 → 无事件
        self.assertEqual(_parse_sse_block(["data: o1", "data: o2"]), [])

    def test_blank_line_resets_state_unconditionally(self) -> None:
        # 空行结束事件后，紧随其后的孤儿 data 行不得混入下一个事件
        events = _parse_sse_block(["event: X", "data: d1", "", "data: orphan", "", "event: Y", "data: d2"])
        self.assertEqual(
            [(event.event, event.data) for event in events],
            [("X", "d1"), ("Y", "d2")],
        )


class RequestSseFragmentationTestCase(unittest.TestCase):
    """把「跨分片」的事件流喂给 request_sse 的解析路径。

    若解析在分片边界而非空行处成型，事件数量与 data 内容都会偏离预期。
    """

    def _run(self, chunks: list[str]):
        _FakeAsyncClient.chunks = chunks
        events = []
        with patch("rizhiyi_mcp.sse_client.httpx.AsyncHTTPTransport", _FakeTransport), patch(
            "rizhiyi_mcp.sse_client.httpx.AsyncClient", _FakeAsyncClient
        ):
            result = asyncio.run(
                request_sse(
                    url="/api/v3/copilot/chat/",
                    headers={},
                    body="{}",
                    config=HttpClientConfig(base_url="https://example.invalid", headers={}),
                    on_event=events.append,
                )
            )
        return events, result

    def test_multi_data_lines_split_across_chunks_form_one_event(self) -> None:
        chunks = [
            "event: STEP_OUTPUT\ndata: {\"id\": \"s1\",",
            '\ndata: "content": "x"}\n\n',
        ]
        events, _ = self._run(chunks)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event, "STEP_OUTPUT")
        self.assertEqual(events[0].data, '{"id": "s1",\n"content": "x"}')

    def test_only_blank_line_terminates_event(self) -> None:
        chunks = [
            'event: META\ndata: {"conversation": {"id": 1}}\n\n',
            'event: STEP_OUTPUT\ndata: {"id": "s1",',
            '\ndata: "content": "```spl\\nindex=prod | stats count\\n```"}\n\n',
            'event: DONE\ndata: {"conversation_id": 7}\n\n',
        ]
        events, result = self._run(chunks)
        self.assertEqual([event.event for event in events], ["META", "STEP_OUTPUT", "DONE"])
        self.assertEqual(
            events[1].data,
            '{"id": "s1",\n"content": "```spl\\nindex=prod | stats count\\n```"}',
        )
        self.assertEqual(result.conversation_id, 7)

    def test_line_split_mid_token_is_reassembled(self) -> None:
        chunks = ["event: META\ndata: {\"a\":", "1}\n\n"]
        events, _ = self._run(chunks)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].data, '{"a":1}')

    def test_crlf_newlines_are_handled(self) -> None:
        chunks = ["event: META\r", "\ndata: {\"a\":1}\r", "\n\r\n"]
        events, _ = self._run(chunks)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].data, '{"a":1}')
        self.assertNotIn("\r", events[0].data)

    def test_eof_without_trailing_blank_line_emits_event(self) -> None:
        """流结束时没有尾随空行（甚至没有尾随换行）时，最后的事件仍要产出。"""
        # e1) 有换行但无空行
        events, _ = self._run(['event: DONE\ndata: {"conversation_id": 42}\n'])
        self.assertEqual([(event.event, event.data) for event in events], [("DONE", '{"conversation_id": 42}')])

        # e2) 完全没有尾随换行
        events, result = self._run(['event: DONE\ndata: {"conversation_id": 42}'])
        self.assertEqual([(event.event, event.data) for event in events], [("DONE", '{"conversation_id": 42}')])
        self.assertEqual(result.conversation_id, 42)

        # e3) 状态跨分片保留，EOF flush 补出最后一个事件
        events, _ = self._run(["event: STEP_OUTPUT\n", 'data: {"id":"s1"}'])
        self.assertEqual([(event.event, event.data) for event in events], [("STEP_OUTPUT", '{"id":"s1"}')])

    def test_second_event_in_same_block_emits_two_events(self) -> None:
        """隐式事件边界：同一块内第二个 event: 行必须先产出前一个 pending 事件。"""
        chunks = ["event: A\ndata: 1\nevent: B\ndata: 2\n\n"]
        events, _ = self._run(chunks)
        self.assertEqual([(event.event, event.data) for event in events], [("A", "1"), ("B", "2")])

    def test_orphan_data_does_not_leak_into_next_event(self) -> None:
        """有 data: 无 event: 的孤儿行必须丢弃，且不得泄漏/污染后续事件。"""
        # 孤儿块经空行后接正常事件
        events, _ = self._run(["data: orphan\n\nevent: X\ndata: real\n\n"])
        self.assertEqual([(event.event, event.data) for event in events], [("X", "real")])

        # 孤儿行紧邻事件名（无空行）
        events, _ = self._run(["data: orphan\nevent: X\ndata: real\n\n"])
        self.assertEqual([(event.event, event.data) for event in events], [("X", "real")])

        # 事件之间的孤儿行既不产出也不污染后续事件
        events, _ = self._run(["event: X\ndata: d1\n\ndata: orphan\n\nevent: Y\ndata: d2\n\n"])
        self.assertEqual([(event.event, event.data) for event in events], [("X", "d1"), ("Y", "d2")])


class HttpxLineSplittingTestCase(unittest.TestCase):
    """确认 ``httpx`` 的 ``aiter_lines()`` 在 CRLF 下不会把 ``\\r`` 留在行尾。

    ``request_sse`` 依赖 ``aiter_lines()`` 完成行切分：若行尾 ``\\r`` 未剥掉，
    ``data: `` 的值就会残留 ``\\r``，与 TS 侧显式 ``slice(0, -1)`` 剥 ``\\r``
    的行为产生分歧。这里直接对真实 ``httpx`` 的行为做断言，而不是依赖测试内的
    行切分辅助函数。
    """

    def test_crlf_lines_have_no_carriage_return(self) -> None:
        async def collect() -> list[str]:
            response = httpx.Response(200, content=b'event: META\r\ndata: {"a":1}\r\n\r\n')
            return [line async for line in response.aiter_lines()]

        lines = asyncio.run(collect())
        self.assertEqual(lines, ["event: META", 'data: {"a":1}', ""])
        self.assertTrue(all("\r" not in line for line in lines))


if __name__ == "__main__":
    unittest.main()
