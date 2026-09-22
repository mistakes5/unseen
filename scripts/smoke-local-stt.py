"""Exercise the same encoded WebM path as Electron, using synthetic speech only."""
import asyncio
import json
from pathlib import Path
import subprocess
import tempfile
import time
import websockets


async def main():
    with tempfile.TemporaryDirectory(prefix='classroom-stt-check-') as directory:
        voice = Path(directory) / 'speech.aiff'
        subprocess.run(['say', '-r', '175', '-o', str(voice),
                        'How does national identity differ from citizenship? '
                        'Can someone explain the distinction between belonging and legal status?'], check=True)
        # ffmpeg streams Opus/WebM to stdout, exactly the format MediaRecorder sends.
        command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-re', '-i', str(voice),
                   '-af', 'apad=pad_dur=3', '-ac', '1', '-c:a', 'libopus', '-f', 'webm', '-']
        uri = 'ws://127.0.0.1:8178/v1/listen?language=en&interim_results=true&endpointing=300'
        finals = []
        started = time.monotonic()
        async with websockets.connect(uri) as ws:
            async def send():
                process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE)
                while block := await process.stdout.read(4096):
                    await ws.send(block)
                assert await process.wait() == 0
                await ws.send(json.dumps({'type': 'CloseStream'}))

            async def receive():
                async for raw in ws:
                    message = json.loads(raw)
                    if message.get('type') == 'Error' or message.get('status') == 'error':
                        raise RuntimeError(message)
                    if message.get('is_final'):
                        text = message.get('channel', {}).get('alternatives', [{}])[0].get('transcript', '')
                        if text:
                            finals.append(text)
                            print(json.dumps({'elapsed_s': round(time.monotonic()-started, 2), 'final': text}), flush=True)

            await asyncio.wait_for(asyncio.gather(send(), receive()), timeout=70)
        text = ' '.join(finals).lower()
        assert 'identity' in text and 'citizenship' in text and 'belonging' in text, text
        print('PASS: streamed WebM produced stable transcript text through the overlay-compatible API.')


asyncio.run(main())
