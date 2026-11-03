"""Offline smoke tests: no internet, no API keys. Run: python -m unittest discover -s tests -v  (from reel-studio/)"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["LLM_PROVIDER"] = "offline"

from reelstudio.agents import script_writer, analyzer          # noqa: E402
from reelstudio.media import captions                          # noqa: E402
from reelstudio.pipeline import Options, run, slugify         # noqa: E402


class ScriptTests(unittest.TestCase):
    def test_offline_script_all_languages(self):
        for lang in ("hindi", "hinglish", "english"):
            for pf in ("instagram", "linkedin"):
                s = script_writer.write("saving money", pf, lang, 30, log=lambda *_: None)
                self.assertEqual(s["scenes"][0]["role"], "hook")
                self.assertEqual(s["scenes"][-1]["role"], "cta")
                self.assertTrue(s["caption"] and s["hashtags"])

    def test_validate_rejects_bad_json(self):
        with self.assertRaises(ValueError):
            script_writer._validate({"scenes": []}, "instagram")


class CaptionTests(unittest.TestCase):
    def test_chunks_respect_limits(self):
        words = [(f"word{i}", i * 0.3, i * 0.3 + 0.25, 0) for i in range(10)]
        for c in captions.chunk_words(words, 3, 18):
            self.assertLessEqual(len(c), 3)

    def test_slug(self):
        self.assertEqual(slugify("Morning Routine!"), "morning-routine")
        self.assertTrue(slugify("सुबह की आदतें").startswith("video-"))


class EndToEnd(unittest.TestCase):
    def test_full_pipeline_with_own_face_video(self):
        """Own-face mode: synthetic 'recording' in, 4:5 LinkedIn video out, analyzer runs."""
        with tempfile.TemporaryDirectory() as d:
            face = Path(d) / "face.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=14",
                            "-f", "lavfi", "-i", "sine=f=220:d=14", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                            "-c:a", "aac", str(face)], check=True)
            out = run(Options(topic="test topic", platforms=["linkedin"], languages=["english"], seconds=12,
                              avatar="face", face_video=str(face), out=str(Path(d) / "o"), max_fixes=0),
                      log=lambda *_: None)
            mp4 = out / "linkedin_english.mp4"
            self.assertTrue(mp4.exists())
            from reelstudio.media import ffutil
            v = next(s for s in ffutil.probe(mp4)["streams"] if s["codec_type"] == "video")
            self.assertEqual((v["width"], v["height"]), (1080, 1350))
            self.assertTrue((out / "REPORT.md").exists())


if __name__ == "__main__":
    unittest.main()
