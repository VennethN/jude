import io
import math
import os
import shutil
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from jude_voice.diarization import (
    MODEL_ID,
    DiarizationError,
    SpeakerTurn,
    diarization_available,
    diarize,
    speaker_at,
)


def wav(samples):
    out = io.BytesIO()
    with wave.open(out, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16_000)
        stream.writeframes(b"".join(struct.pack("<h", x) for x in samples))
    return out.getvalue()


class DiarizationTest(unittest.TestCase):
    def setUp(self):
        sandbox = tempfile.TemporaryDirectory()
        self.addCleanup(sandbox.cleanup)
        self.root = Path(sandbox.name)
        model = self.root / "model"
        model.mkdir()
        (model / "config.yaml").write_text("fixture: true")
        self.executable = self.root / "fixture-python"
        env = patch.dict(
            os.environ,
            {
                "JUDE_DIARIZATION_MODEL": str(model),
                "JUDE_DIARIZATION_DEVICE": "cpu",
                "JUDE_DIARIZATION_PYTHON": str(self.executable),
                "JUDE_DIARIZATION_TIMEOUT_MS": "3000",
                "OPENAI_API_KEY": "fixture-secret",
                "HF_TOKEN": "fixture-hub-secret",
            },
        )
        env.start()
        self.addCleanup(env.stop)
        # The injectable interpreter runs a real isolated process using a deterministic WAV fixture.
        self.fixture("""
import json,os,sys,wave
from pathlib import Path
sample,target = map(Path, sys.argv[2:])
root=Path(__file__).parent
(root / 'observed').write_text(str(sample))
assert sample.stat().st_mode & 0o777 == 0o600
assert sample.parent.stat().st_mode & 0o777 == 0o700
assert 'OPENAI_API_KEY' not in os.environ and 'HF_TOKEN' not in os.environ
assert os.environ['HF_HUB_OFFLINE'] == '1' and os.environ['PYANNOTE_METRICS_ENABLED']=='0'
with wave.open(str(sample),'rb') as stream:
    assert stream.getframerate()==16000 and stream.getnframes()==32000
target.write_text(json.dumps([{'start':0,'end':.75,'speaker':'SPEAKER_00'},
                              {'start':1.1,'end':2,'speaker':'SPEAKER_01'}]))
""")

    def fixture(self, script):
        self.executable.write_text("#!" + sys.executable + "\n" + script)
        self.executable.chmod(0o700)

    def test_process_privacy_and_anonymous_labels_per_recording(self):
        sample = wav(
            round(4000 * math.sin(i * (0.08 if i < 12000 else 0.15))) if i < 12000 or i > 17600 else 0
            for i in range(32000)
        )
        first, second = diarize(sample, ".wav"), diarize(sample, "wav")
        self.assertEqual([(t.start, t.end) for t in first], [(0.0, 0.75), (1.1, 2.0)])
        self.assertNotEqual(first[0].speaker, first[1].speaker)
        self.assertNotEqual(first[0].speaker, second[0].speaker)
        self.assertEqual(speaker_at(first, 1.0, 1.9), first[1].speaker)
        self.assertIsNone(speaker_at(first, 0.8, 1.0))
        self.assertFalse(Path((self.root / "observed").read_text()).parent.exists())

    def test_worker_failure_timeout_and_empty_configuration(self):
        self.fixture(
            "import sys; from pathlib import Path; Path(__file__).with_name('observed').write_text(sys.argv[2]); sys.exit(1)"
        )
        with self.assertRaises(DiarizationError):
            diarize(b"fixture", "wav")
        self.assertFalse(Path((self.root / "observed").read_text()).parent.exists())
        self.fixture(
            "import time,sys; from pathlib import Path; Path(__file__).with_name('observed').write_text(sys.argv[2]);time.sleep(10)"
        )
        with (
            patch.dict(os.environ, {"JUDE_DIARIZATION_TIMEOUT_MS": "350"}),
            self.assertRaisesRegex(DiarizationError, "timed out"),
        ):
            diarize(b"fixture", "wav")
        self.assertFalse(Path((self.root / "observed").read_text()).parent.exists())
        with patch.dict(os.environ, {"JUDE_DIARIZATION_MODEL": ""}):
            self.assertFalse(diarization_available())
            self.assertEqual(diarize(b"fixture", "wav"), [])
        with patch.dict(os.environ, {"JUDE_DIARIZATION_MODEL": MODEL_ID, "HF_TOKEN": ""}):
            self.assertFalse(diarization_available())

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is required for the live decoding boundary")
    def test_actual_worker_decodes_silent_audio_without_creating_speakers(self):
        with patch.dict(os.environ, {"JUDE_DIARIZATION_PYTHON": sys.executable}):
            self.assertEqual(diarize(wav([0] * 4800), "wav"), [])
            with self.assertRaises(DiarizationError):
                diarize(b"this recording is malformed", ".wav")

    def test_alignment_ties_weak_evidence_boundaries_and_repeated_speaker(self):
        turns = [
            SpeakerTurn(0, 0.3, "a"),
            SpeakerTurn(0.3, 0.5, "b"),
            SpeakerTurn(0.5, 0.9, "a"),
            SpeakerTurn(0.9, 1.2, "b"),
        ]
        self.assertEqual(speaker_at(turns, 0, 1), "a")
        self.assertIsNone(speaker_at(turns, 0.1, 0.5))
        self.assertIsNone(speaker_at(turns, 1.1, 3))
        self.assertEqual(speaker_at(turns, 0.3, 0.3), "b")
        self.assertIsNone(speaker_at(turns, 1.2, 1.2))
        self.assertIsNone(speaker_at(turns, 0.5, 0.4))
        self.assertIsNone(speaker_at(turns, 0, math.nan))


if __name__ == "__main__":
    unittest.main()
