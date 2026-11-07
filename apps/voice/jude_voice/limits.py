"""Limit a multipart upload even when the client uses chunked transfer encoding."""

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

MAX_UPLOAD = 25 * 1024 * 1024
MAX_REQUEST = MAX_UPLOAD + 64 * 1024


class UploadLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or not scope["path"].endswith("/upload")
        ):
            return await self.app(scope, receive, send)
        length = dict(scope.get("headers", [])).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > MAX_REQUEST):
            response = JSONResponse(
                {"error": {"code": "file_too_large", "message": "Audio must fit within 25 MB."}}, 413
            )
            return await response(scope, receive, send)
        size = 0

        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > MAX_REQUEST:
                raise HTTPException(status_code=413, detail="Audio must fit within 25 MB.")
            return message

        await self.app(scope, bounded_receive, send)
