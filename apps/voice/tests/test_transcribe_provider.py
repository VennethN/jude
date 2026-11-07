"""Synthetic AWS protocol tests. No network, model downloads, or paid requests."""

import asyncio
import hashlib
import hmac
import json
import struct
import unittest
from unittest.mock import AsyncMock, Mock, patch
from urllib.parse import parse_qs, urlsplit

from botocore.credentials import Credentials
from botocore.eventstream import ChecksumMismatch, EventStreamBuffer

from jude_voice import providers
from jude_voice import transcribe as aws


def result(identifier="one", partial=False, text="Dua kata.", items=None):
    return {
        "ResultId": identifier,
        "StartTime": 0,
        "EndTime": 0.2,
        "IsPartial": partial,
        "Alternatives": [{"Transcript": text, "Items": items or []}],
    }


def response(*results):
    return aws._event(
        json.dumps({"Transcript": {"Results": results}}).encode(),
        {
            ":message-type": "event",
            ":event-type": "TranscriptEvent",
            ":content-type": "application/json",
        },
    )


def decode(frame):
    buffer = EventStreamBuffer()
    buffer.add_data(frame)
    return next(buffer)


class Socket:
    def __init__(self, replies=()):
        self.replies = list(replies)
        self.queue = asyncio.Queue()
        self.sent = []
        self.send_times = []
        self.closed = False

    async def send(self, frame):
        self.sent.append(frame)
        self.send_times.append(asyncio.get_running_loop().time())
        if not decode(frame).payload:
            for reply in self.replies:
                await self.queue.put(reply)
            await self.queue.put(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        value = await self.queue.get()
        if value is None:
            raise StopAsyncIteration
        if isinstance(value, Exception):
            raise value
        return value

    async def close(self):
        self.closed = True


class ProtocolTest(unittest.TestCase):
    def test_audio_framing_roundtrip_and_crc_validation(self):
        raw = aws.audio_event(b"\x01\0" * 2400)
        self.assertEqual(struct.unpack(">I", raw[:4])[0], len(raw))
        message = decode(raw)
        self.assertEqual(message.payload, b"\x01\0" * 2400)
        self.assertEqual(message.headers[":event-type"], "AudioEvent")
        self.assertEqual(decode(aws.audio_event(b"")).payload, b"")
        for index in (0, 8, 100, len(raw) - 1):
            corrupted = bytearray(raw)
            corrupted[index] ^= 1
            with self.subTest(index=index), self.assertRaises(ChecksumMismatch):
                decode(bytes(corrupted))

    def test_readiness_uses_region_and_credential_chain(self):
        credentials = Credentials(
            "synthetic-key", "synthetic-secret", "synthetic-token"
        )
        session = Mock()
        session.get_available_regions.return_value = ["ap-southeast-1", "us-east-1"]
        session.get_credentials.return_value = credentials
        with (
            patch.object(aws.boto3, "Session", return_value=session),
            patch.dict("os.environ", {"OPENAI_API_KEY": ""}, clear=True),
        ):
            self.assertTrue(aws.transcription_available())
            with patch.dict("os.environ", {"JUDE_TRANSCRIBE_REGION": "ap-southeast-3"}):
                self.assertFalse(aws.transcription_available())
            session.get_credentials.return_value = None
            self.assertFalse(aws.transcription_available())
            session.get_credentials.side_effect = RuntimeError("SECRET")
            self.assertFalse(aws.transcription_available())
            with self.assertRaises(aws.ProviderError) as caught:
                aws._presigned_url("id", 24000)
            self.assertNotIn("SECRET", str(caught.exception))

    def test_signed_url_and_temporary_credentials(self):
        creds = Credentials(
            "synthetic-key", "synthetic-secret", "token+/=="
        ).get_frozen_credentials()
        with patch.object(
            aws, "_configuration", return_value=("ap-southeast-1", creds)
        ):
            url = aws._presigned_url("id", 24000)
            english = parse_qs(urlsplit(aws._presigned_url("en", 16000)).query)
        parsed = urlsplit(url)
        values = parse_qs(parsed.query)
        self.assertEqual(
            parsed.netloc, "transcribestreaming.ap-southeast-1.amazonaws.com:8443"
        )
        self.assertEqual(parsed.scheme, "wss")
        self.assertEqual(values["language-code"], ["id-ID"])
        self.assertEqual(english["language-code"], ["en-US"])
        for key, expected in {
            "show-speaker-label": "true",
            "partial-results-stability": "medium",
            "enable-partial-results-stabilization": "true",
            "sample-rate": "24000",
            "X-Amz-Expires": "300",
            "X-Amz-SignedHeaders": "host",
            "X-Amz-Security-Token": "token+/==",
        }.items():
            self.assertEqual(values[key], [expected])
        # Regression: STS padding is encoded once, identically on the wire and
        # in the canonical query. Double encoding signs a different token.
        self.assertIn("X-Amz-Security-Token=token%2B%2F%3D%3D", parsed.query)
        self.assertNotIn("%253D", parsed.query)
        query = "&".join(
            sorted(
                p
                for p in parsed.query.split("&")
                if not p.startswith("X-Amz-Signature=")
            )
        )
        canonical = (
            "GET\n"
            + parsed.path
            + "\n"
            + query
            + "\nhost:"
            + parsed.netloc
            + "\n\nhost\n"
            + hashlib.sha256(b"").hexdigest()
        )
        date = values["X-Amz-Date"][0]
        scope = date[:8] + "/ap-southeast-1/transcribe/aws4_request"
        key = b"AWS4synthetic-secret"
        for value in (date[:8], "ap-southeast-1", "transcribe", "aws4_request"):
            key = hmac.new(key, value.encode(), hashlib.sha256).digest()
        signing = (
            "AWS4-HMAC-SHA256\n"
            + date
            + "\n"
            + scope
            + "\n"
            + hashlib.sha256(canonical.encode()).hexdigest()
        )
        self.assertEqual(
            values["X-Amz-Signature"][0],
            hmac.new(key, signing.encode(), hashlib.sha256).hexdigest(),
        )

    def test_native_speaker_transitions_and_bounds(self):
        items = [
            {"Content": "Dua", "StartTime": -1, "EndTime": 0.1, "Speaker": "spk_0"},
            {"Content": ",", "Type": "punctuation"},
            {"Content": "kata", "StartTime": 0.1, "EndTime": 0.5, "Speaker": "spk_1"},
            {"Content": ".", "Type": "punctuation"},
        ]
        event = aws.normalize_result(result(items=items), 0.2)
        self.assertEqual(
            event["segments"],
            [
                {
                    "start": 0,
                    "end": 0.1,
                    "text": "Dua,",
                    "speaker": "spk_0",
                    "words": [{"start": 0, "end": 0.1, "text": "Dua,"}],
                },
                {
                    "start": 0.1,
                    "end": 0.2,
                    "text": "kata.",
                    "speaker": "spk_1",
                    "words": [{"start": 0.1, "end": 0.2, "text": "kata."}],
                },
            ],
        )
        self.assertIsNone(aws.normalize_result(result(), 0.2)["segments"][0]["speaker"])
        self.assertNotIn("words", aws.normalize_result(result(), 0.2)["segments"][0])
        with self.assertRaises(ValueError):
            aws.normalize_result(dict(result(), StartTime=float("nan")), 0.2)

    def test_words_keep_stream_time_and_punctuation_when_speaker_is_merged(self):
        items = [
            {
                "Type": "pronunciation",
                "Content": "Synthetic",
                "StartTime": 4,
                "EndTime": 4.3,
                "Speaker": "0",
            },
            {
                "Type": "pronunciation",
                "Content": "words",
                "StartTime": 4.5,
                "EndTime": 5,
                "Speaker": "0",
            },
            {"Type": "punctuation", "Content": "."},
        ]
        event = aws.normalize_result(
            dict(result(items=items), StartTime=4, EndTime=5), 6
        )
        self.assertEqual(len(event["segments"]), 1)
        segment = event["segments"][0]
        self.assertEqual(segment["text"], "Synthetic words.")
        self.assertEqual(
            segment["words"],
            [
                {"start": 4, "end": 4.3, "text": "Synthetic"},
                {"start": 4.5, "end": 5, "text": "words."},
            ],
        )


class TimestampRegressionTest(unittest.TestCase):
    def test_zero_and_overlapping_words_keep_text_in_valid_timed_tokens(self):
        items = [
            {"Content": "Synthetic", "StartTime": 0, "EndTime": 0, "Speaker": "0"},
            {"Content": "half", "StartTime": 0, "EndTime": 0.1, "Speaker": "0"},
            {"Content": "past", "StartTime": 0.08, "EndTime": 0.15, "Speaker": "0"},
            {"Content": "nine", "StartTime": 0.15, "EndTime": 0.15, "Speaker": "0"},
            {"Content": ".", "Type": "punctuation"},
        ]
        event = aws.normalize_result(
            result(text="Synthetic half past nine.", items=items), 0.2
        )
        self.assertEqual(event["segments"][0]["text"], "Synthetic half past nine.")
        self.assertEqual(
            event["segments"][0]["words"],
            [
                {"start": 0, "end": 0.15, "text": "Synthetic half past nine."},
            ],
        )

    def test_wholly_zero_word_uses_result_bounds_without_losing_wording(self):
        items = [
            {"Content": "Synthetic", "StartTime": 0.1, "EndTime": 0.1, "Speaker": "0"}
        ]
        event = aws.normalize_result(result(text="Synthetic", items=items), 0.2)
        self.assertEqual(
            event["segments"],
            [
                {
                    "start": 0,
                    "end": 0.2,
                    "text": "Synthetic",
                    "speaker": "0",
                    "words": [{"start": 0, "end": 0.2, "text": "Synthetic"}],
                }
            ],
        )

    def test_empty_or_zero_result_never_emits_invalid_segment(self):
        for value, duration in (
            (result(text=""), 0.2),
            (result(), 0),
            (dict(result(), StartTime=0.2, EndTime=0.1), 0.2),
        ):
            with self.subTest(value=value, duration=duration):
                self.assertEqual(aws.normalize_result(value, duration)["segments"], [])


class StreamTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sign = patch.object(
            aws, "_presigned_url", return_value="wss://synthetic.invalid"
        )
        self.sign.start()
        self.addCleanup(self.sign.stop)

    async def test_continuous_socket_pacing_aliases_and_native_events(self):
        first = response(result(partial=True, text="Dua"))
        last = response(
            result(), result()
        )  # AWS duplicates must not duplicate a final.
        socket = Socket([first[:9], first[9:] + last])
        with patch.object(
            aws, "connect", new=AsyncMock(return_value=socket)
        ) as connect:
            async with aws.TranscribeStream("id") as stream:

                async def collect():
                    return [event async for event in stream.events()]

                receiver = asyncio.create_task(collect())
                await stream.send_audio(b"\x01\0" * 1200)
                self.assertEqual(socket.sent, [])
                await stream.send_audio(b"\x01\0" * 3600)
                await stream.end_input()
                await stream.end_audio()
                events = await receiver
                with self.assertRaises(aws.ProviderError):
                    await stream.send_audio(b"\x01\0")
            connect.assert_awaited_once()
        self.assertEqual([e["partial"] for e in events], [True, False])
        self.assertEqual(
            set(events[-1]), {"id", "partial", "start", "end", "text", "segments"}
        )
        self.assertEqual([len(decode(x).payload) for x in socket.sent], [4800, 4800, 0])
        self.assertGreaterEqual(socket.send_times[1] - socket.send_times[0], 0.09)
        self.assertTrue(socket.closed)

    async def test_turn_collects_all_finals_and_replaces_partial_hypotheses(self):
        socket = Socket(
            [
                response(result(partial=True, text="Du")),
                response(result(partial=True, text="Dua")),
                response(result()),
                response(dict(result("two", text="Lagi."), StartTime=0.15)),
            ]
        )
        partial = AsyncMock()
        with patch.object(aws, "connect", new=AsyncMock(return_value=socket)):
            async with providers.Realtime("id") as realtime:
                text = await realtime.transcribe(b"\x01\0" * 4800, partial)
                self.assertEqual(text, "Dua kata. Lagi.")
                self.assertEqual(
                    [s["text"] for s in realtime.segments], ["Dua kata.", "Lagi."]
                )
                self.assertEqual(
                    [c.args[0] for c in partial.await_args_list], ["Du", "Dua"]
                )
                self.assertEqual(await realtime.transcribe(bytes(4800), partial), "")
                self.assertEqual(realtime.segments, [])
        self.assertTrue(socket.closed)

    async def test_short_pcm_padding_is_excluded_from_segments(self):
        socket = Socket(
            [
                response(
                    result(
                        items=[
                            {
                                "Type": "pronunciation",
                                "Content": "Synthetic",
                                "StartTime": 0,
                                "EndTime": 0.1,
                                "Speaker": "0",
                            },
                        ]
                    )
                )
            ]
        )
        original = b"\x01\0"
        with patch.object(aws, "connect", new=AsyncMock(return_value=socket)):
            realtime = providers.Realtime("id")
            await realtime.transcribe(original, AsyncMock())
        self.assertEqual(decode(socket.sent[0]).payload, original.ljust(4800, b"\0"))
        self.assertEqual(realtime.segments[0]["end"], 1 / 24000)
        self.assertEqual(
            realtime.segments[0]["words"],
            [
                {"start": 0, "end": 1 / 24000, "text": "Synthetic"},
            ],
        )
        self.assertEqual(original, b"\x01\0")

    async def test_incomplete_corrupt_exception_and_text_frames_fail_closed(self):
        exception = aws._event(b'{"Message":"SECRET"}', {":message-type": "exception"})
        corrupted = response(result())[:-1] + b"\x00"
        for replies in (
            [response(result())[:10]],
            [response(result(partial=True))],
            [exception],
            [corrupted],
            ["not binary"],
            [b"bad crc frame!!!!"],
        ):
            with self.subTest(replies=replies):
                socket = Socket(replies)
                with (
                    patch.object(aws, "connect", new=AsyncMock(return_value=socket)),
                    self.assertRaises(aws.ProviderError) as caught,
                ):
                    await aws.recognize(b"\x01\0" * 2400, 24000, "id")
                self.assertNotIn("SECRET", str(caught.exception))
                self.assertTrue(socket.closed)

    async def test_premature_close_and_cancel_close_socket(self):
        socket = Socket()
        with patch.object(aws, "connect", new=AsyncMock(return_value=socket)):
            async with aws.TranscribeStream("id") as stream:
                await socket.queue.put(None)
                with self.assertRaises(aws.ProviderError):
                    _ = [event async for event in stream.events()]
        socket = Socket()
        with patch.object(aws, "connect", new=AsyncMock(return_value=socket)):

            async def consume():
                async with aws.TranscribeStream("id") as stream:
                    async for _ in stream.events():
                        pass

            task = asyncio.create_task(consume())
            for _ in range(20):
                await asyncio.sleep(0.001)
                if socket.queue._getters:
                    break
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertTrue(socket.closed)

    async def test_connect_and_send_errors_are_sanitized(self):
        with (
            patch.object(
                aws, "connect", new=AsyncMock(side_effect=RuntimeError("SECRET"))
            ),
            self.assertRaisesRegex(
                aws.ProviderError, "^Transcription session unavailable.$"
            ),
        ):
            async with aws.TranscribeStream("id"):
                pass
        socket = Socket()
        socket.send = AsyncMock(side_effect=RuntimeError("SECRET"))
        with (
            patch.object(aws, "connect", new=AsyncMock(return_value=socket)),
            self.assertRaisesRegex(
                aws.ProviderError, "^Transcription was interrupted.$"
            ),
        ):
            await aws.recognize(b"\x01\0" * 2400, 24000, "id")
        self.assertTrue(socket.closed)

    async def test_pcm_validation_and_silence_do_not_connect(self):
        with patch.object(aws, "connect", new=AsyncMock()) as connect:
            self.assertEqual(await aws.recognize(bytes(4800), 24000, "id"), ("", []))
            with self.assertRaises(ValueError):
                await aws.recognize(b"\x01", 24000, "id")
            connect.assert_not_called()

    async def test_drain_timeout_cleans_up_and_does_not_return_partial_text(self):
        socket = Socket()
        socket.send = AsyncMock()  # Simulate a peer that never closes after EOF.
        with patch.object(aws, "connect", new=AsyncMock(return_value=socket)):
            async with aws.TranscribeStream("id") as stream:
                await stream.end_audio()
                stream._drain_deadline = asyncio.get_running_loop().time() + 0.01
                with self.assertRaises(aws.ProviderError):
                    _ = [event async for event in stream.events()]
        self.assertTrue(socket.closed)

    async def test_file_uses_one_stream_with_recording_wide_native_labels(self):
        native = [
            {"start": 0, "end": 0.1, "text": "Synthetic one", "speaker": "0"},
            {"start": 0.1, "end": 0.2, "text": "Synthetic two", "speaker": "1"},
            {"start": 0.2, "end": 0.3, "text": "Synthetic three", "speaker": "0"},
        ]
        pcm = b"\x01\0" * 4800
        with (
            patch.object(providers, "transcription_available", return_value=True),
            patch.object(providers, "normalize_audio", return_value=pcm),
            patch.object(
                providers,
                "recognize",
                new=AsyncMock(return_value=("Synthetic", native)),
            ) as recognize,
        ):
            segments, duration = await providers.transcribe_file(
                b"synthetic", ".wav", "id"
            )
        self.assertEqual(duration, 0.3)
        self.assertEqual(segments, native)
        recognize.assert_awaited_once_with(pcm, 16000, "id")

    async def test_unconfigured_file_never_decodes_or_streams(self):
        with (
            patch.object(providers, "transcription_available", return_value=False),
            patch.object(providers, "normalize_audio") as normalize,
        ):
            with self.assertRaises(aws.ProviderError):
                await providers.transcribe_file(b"synthetic", ".wav", "id")
            normalize.assert_not_called()


if __name__ == "__main__":
    unittest.main()
