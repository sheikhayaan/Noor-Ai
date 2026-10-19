"""Repair UTF-8 text that was decoded as a single-byte codec ("mojibake").

Observed live: a cached answer came back containing ``overâ€˜theâ€˜counter``
instead of ``over-the-counter``. That is U+2018 (``E2 80 98``) decoded as
Windows-1252, then re-encoded as UTF-8. The corruption is baked into the cached
row, so it can never be fixed by normalising at the provider boundary alone —
the read path has to repair it.

The repair is deliberately conservative:

* it only runs when the text actually contains a mojibake signature,
* it requires the round-trip to succeed *and* to strictly reduce the number of
  those signatures, so legitimate text that happens to contain ``Ã`` is left
  untouched,
* it never raises — worst case the original string is returned unchanged.
"""
from __future__ import annotations

# Sequences that essentially never appear in correctly decoded English text but
# are ubiquitous in UTF-8-read-as-cp1252 output.
_SIGNATURES = ("\u00e2\u20ac", "\u00c3\u00a2", "\u00c3\u00a9", "\u00c3\u00bc",
               "\u00c3\u00b6", "\u00c3\u00a4", "\u00c2\u00a0", "\u00ef\u00bb\u00bf")

# cp1252 leaves five bytes undefined; latin-1 accepts every byte. Trying both
# covers the two common corruption paths (`decode("cp1252")`, `decode("latin-1")`).
_CODECS = ("cp1252", "latin-1")


def _signature_count(text: str) -> int:
    return sum(text.count(marker) for marker in _SIGNATURES)


# A run of non-ASCII characters: the unit mojibake actually comes in. Repairing
# run-by-run (instead of whole-string) matters because one unencodable character
# elsewhere in a long answer would otherwise abort the fix for the entire text.
def _runs(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    start: int | None = None
    for index, char in enumerate(text):
        if ord(char) > 0x7F:
            if start is None:
                start = index
        elif start is not None:
            spans.append((start, index))
            start = None
    if start is not None:
        spans.append((start, len(text)))
    return spans


def _try_repair(chunk: str) -> str:
    """Return a repaired chunk, or the original if no strict improvement exists."""
    score = _signature_count(chunk)
    if score == 0:
        return chunk

    best = chunk
    best_score = score
    for codec in _CODECS:
        try:
            candidate = chunk.encode(codec, errors="strict").decode("utf-8", errors="strict")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        candidate_score = _signature_count(candidate)
        # Strict improvement only: this is what stops us from "repairing" text
        # that is already valid but happens to contain similar-looking glyphs.
        if candidate_score < best_score:
            best = candidate
            best_score = candidate_score
    return best


def repair_mojibake(text: str) -> str:
    """Best-effort repair of UTF-8 text that was decoded as a single-byte codec."""
    if not isinstance(text, str) or not text:
        return text
    if _signature_count(text) == 0:
        return text

    # Whole string first (common case: a short field), then per run of
    # non-ASCII characters (long answers containing stray unencodable glyphs).
    whole = _try_repair(text)
    if whole != text:
        return whole

    pieces: list[str] = []
    cursor = 0
    for start, end in _runs(text):
        pieces.append(text[cursor:start])
        pieces.append(_try_repair(text[start:end]))
        cursor = end
    pieces.append(text[cursor:])
    return "".join(pieces)


def repair_payload(value):
    """Recursively repair strings inside lists/dicts (API responses, rows)."""
    if isinstance(value, str):
        return repair_mojibake(value)
    if isinstance(value, list):
        return [repair_payload(item) for item in value]
    if isinstance(value, tuple):
        return tuple(repair_payload(item) for item in value)
    if isinstance(value, dict):
        return {key: repair_payload(item) for key, item in value.items()}
    return value
