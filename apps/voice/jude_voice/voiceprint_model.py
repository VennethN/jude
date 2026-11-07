"""Install a pinned, public WeSpeaker model for offline runtime inference."""

import argparse
import hashlib
from pathlib import Path

MODEL_ID = "pyannote/wespeaker-voxceleb-resnet34-LM"
MODEL_REVISION = "837717ddb9ff5507820346191109dc79c958d614"
WEIGHTS_SHA256 = "366edf44f4c80889a3eb7a9d7bdf02c4aede3127f7dd15e274dcdb826b143c56"


def install(destination):
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION, local_dir=destination,
                      allow_patterns=["config.yaml", "pytorch_model.bin", "README.md"])
    weights = Path(destination) / "pytorch_model.bin"
    if hashlib.sha256(weights.read_bytes()).hexdigest() != WEIGHTS_SHA256:
        raise ValueError("Voiceprint model checksum mismatch")
    return weights.resolve()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination")
    print(install(parser.parse_args().destination))
