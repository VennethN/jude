"""Legacy refinement must use a statement's audio, not its entire capture."""
import unittest
from unittest.mock import MagicMock, patch

from jude_voice.speakers import BYTES_PER_SECOND, process_recording


class SpeakerSpansTest(unittest.TestCase):
    def test_adjacent_speakers_are_sent_as_separate_audio_spans(self):
        repo = MagicMock()
        first, second = b'\x01\x00' * 24000, b'\x02\x00' * 24000
        repo.storage.get.return_value = first + second
        repo.diarization_inputs.return_value = {
            'statements': [{'id': 'a'}, {'id': 'b'}],
            'turns': [{'object_key': 'synthetic', 'statement_spans': [
                {'statement_id': 'a', 'start': 0, 'end': 1},
                {'statement_id': 'b', 'start': 1, 'end': 2},
            ]}],
        }
        with patch('jude_voice.speakers.SpeakerWindow') as window:
            window.return_value.label.return_value = {'a': 'voice-a', 'b': 'voice-b'}
            process_recording(repo, 'job')
            window.return_value.label.assert_called_once_with([('a', first), ('b', second)])
        self.assertEqual(len(first), BYTES_PER_SECOND)
        repo.finish_diarization.assert_called_once_with('job', {'a': 'voice-a', 'b': 'voice-b'})
