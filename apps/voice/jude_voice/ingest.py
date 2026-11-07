"""Capture microphone turns independently of recognition, speaker grouping, and findings."""

import asyncio
import logging
from contextlib import AsyncExitStack

from anyio import CancelScope
from starlette.websockets import WebSocketDisconnect

from .providers import ProviderError
from .repository import statement_id

MAX_IN_FLIGHT = 3
LOG = logging.getLogger(__name__)


async def write_transaction(fn, *args, **kwargs):
    # Cancellation cannot stop a file/SQL write already underway. Join it before releasing the recorder.
    write = asyncio.create_task(asyncio.to_thread(fn, *args, **kwargs))
    try:
        return await asyncio.shield(write)
    except asyncio.CancelledError:
        with CancelScope(shield=True):
            await write
        raise


async def stream_turns(ws, repo, session, case_id, hearing_id, lease, decode, realtime, speakers):
    language = "en" if ws.query_params.get("lang") == "en" else "id"
    connections = [None] * MAX_IN_FLIGHT
    contexts = [AsyncExitStack() for _ in connections]
    speaker_queue = asyncio.Queue(maxsize=MAX_IN_FLIGHT)
    socket_writer = asyncio.Lock()
    scope = (session, case_id, hearing_id)

    async def send(frame):
        async with socket_writer:
            await ws.send_json(frame)

    async def acknowledge(receipt):
        ack = {"type": "ack", "id": receipt["id"]}
        if receipt["statementId"]:
            ack["statementId"] = receipt["statementId"]
        await send(ack)

    async def heartbeat():
        while True:
            await asyncio.sleep(10)
            await asyncio.to_thread(repo.renew, *scope, lease)

    def label_batch(batch):
        # The acoustic anchors belong only to this recording connection. A single worker updates them.
        labels = speakers.label([(sid, pcm) for _, sid, pcm in sorted(batch, key=lambda row: row[0])])
        if labels:
            repo.finalize_speakers(*scope, labels)

    async def label_speakers():
        while True:
            batch = [await speaker_queue.get()]
            while not speaker_queue.empty():
                batch.append(speaker_queue.get_nowait())
            try:
                await asyncio.to_thread(label_batch, batch)
            except Exception:  # noqa: BLE001 - an uncertain speaker must not interrupt saved testimony
                LOG.warning("An anonymous speaker assignment was unavailable")
            finally:
                for _ in batch:
                    speaker_queue.task_done()

    async def process(lane, turn):
        tid, start, pcm, keep = turn
        receipt = await write_transaction(
            repo.begin_turn, *scope, lease=lease, turn_id=tid, start=start, pcm=pcm, keep=keep
        )
        assign = False
        if receipt is None:
            words = ""
            if any(pcm):
                async def partial(text):
                    await send({"type": "partial", "id": statement_id(hearing_id, tid), "t": start, "text": text})

                try:
                    if connections[lane] is None:
                        connections[lane] = await contexts[lane].enter_async_context(realtime(language))
                    words = await connections[lane].transcribe(pcm, partial)
                except WebSocketDisconnect:
                    raise
                except Exception as exc:
                    connections[lane] = None
                    await contexts[lane].aclose()
                    raise ProviderError("Transcription was interrupted.") from exc
            receipt = await write_transaction(repo.finish_turn, *scope, lease=lease, turn_id=tid, text=words)
            assign = bool(receipt["statementId"] and not keep)
        await acknowledge(receipt)
        if assign:
            await speaker_queue.put((start, receipt["statementId"], pcm))

    available = list(reversed(range(MAX_IN_FLIGHT)))
    active = {}
    pending_ids = {}
    buffered = None
    receiver = None
    failed = None
    health = asyncio.create_task(heartbeat())
    labeler = asyncio.create_task(label_speakers())
    try:
        await send({"type": "ready", "maxInFlight": MAX_IN_FLIGHT})
        while True:
            if buffered is not None and available:
                lane = available.pop()
                task = asyncio.create_task(process(lane, buffered))
                active[task] = (lane, buffered[0])
                pending_ids[buffered[0]] = buffered
                buffered = None
            if failed and not active and buffered is None:
                raise failed
            if not failed and buffered is None and receiver is None:
                receiver = asyncio.create_task(ws.receive_json())
            # One extra frame allows disconnect detection even with all recognizers busy.
            # Beyond that, the websocket and the browser's durable queue provide backpressure.
            watched = {health, labeler, *active}
            if receiver is not None:
                watched.add(receiver)
            done, _ = await asyncio.wait(watched, return_when=asyncio.FIRST_COMPLETED)
            for task in done & active.keys():
                lane, tid = active.pop(task)
                available.append(lane)
                del pending_ids[tid]
                try:
                    task.result()
                except ProviderError as exc:
                    # Let other admitted turns publish their own transcripts and acknowledgements
                    # before reconnecting. The failed turn remains pending in the recorder.
                    failed = exc
            for task in done & {health, labeler}:
                task.result()
            if receiver in done:
                turn = decode(receiver.result())
                receiver = None
                if turn[0] in pending_ids:
                    if pending_ids[turn[0]] != turn:
                        raise ValueError("Conflicting turn payloads")
                    receipt = await asyncio.to_thread(repo.committed_turn, *scope, turn[0])
                    if receipt is not None:
                        await acknowledge(receipt)
                else:
                    buffered = turn
            elif failed and receiver is not None:
                receiver.cancel()
                await asyncio.gather(receiver, return_exceptions=True)
                receiver = None
    finally:
        with CancelScope(shield=True):
            tasks = [health, *active]
            if receiver is not None:
                tasks.append(receiver)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            # A final ACK can be followed immediately by a clean browser disconnect. Give the
            # last transcript-only batch a chance to label before discarding its acoustic context.
            try:
                async with asyncio.timeout(1):
                    await speaker_queue.join()
            except TimeoutError:
                pass
            labeler.cancel()
            await asyncio.gather(labeler, return_exceptions=True)
            await asyncio.gather(*(ctx.aclose() for ctx in contexts), return_exceptions=True)
