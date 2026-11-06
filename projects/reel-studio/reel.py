"""Launcher: works from any folder.  python projects/reel-studio/reel.py <command> ..."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reelstudio.cli import main  # noqa: E402

raise SystemExit(main())
