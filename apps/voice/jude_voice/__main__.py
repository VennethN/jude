import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "jude_voice.app:app",
        host=os.getenv("VOICE_HOST", "127.0.0.1"),
        port=int(os.getenv("VOICE_PORT", "3001")),
        ws_max_size=2_100_000,
        server_header=False,
        proxy_headers=False,
    )
