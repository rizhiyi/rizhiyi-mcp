from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

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
        event = _parse_sse_block(
            [
                "event: STEP_OUTPUT",
                'data: {"id": "s1",',
                'data: "content": "x"}',
            ]
        )
        self.assertIsNotNone(event)
        assert event is not None
        self.assertEqual(event.event, "STEP_OUTPUT")
        self.assertEqual(event.data, '{"id": "s1",\n"content": "x"}')

    def test_incomplete_block_yields_no_event(self) -> None:
        # 只有 event 名、还没有任何 data 行时，不得成型为事件
        self.assertIsNone(_parse_sse_block(["event: STEP_OUTPUT"]))
        # 只有 data、没有 event 名时同样不成型（与原实现一致）
        self.assertIsNone(_parse_sse_block(["data: orphan"]))
        # 注释行被忽略
        self.assertIsNone(_parse_sse_block([": keep-alive"]))


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


if __name__ == "__main__":
    unittest.main()
