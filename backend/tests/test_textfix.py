"""Encoding repair: cached text must never reach the user as mojibake."""
from backend.app.textfix import repair_mojibake, repair_payload

# UTF-8 bytes decoded as cp1252, then re-encoded — the exact damage seen in a
# live cached answer ("over-the-counter" with U+2011 hyphens).
MOJIBAKE_HYPHEN = "over\u00e2\u20ac\u2018the\u00e2\u20ac\u2018counter"
MOJIBAKE_CAFE = "caf\u00c3\u00a9"


def test_repairs_curly_hyphen_mojibake():
    assert repair_mojibake(MOJIBAKE_HYPHEN) == "over\u2011the\u2011counter"


def test_repairs_accented_letters():
    assert repair_mojibake(MOJIBAKE_CAFE) == "caf\u00e9"


def test_leaves_clean_text_untouched():
    for text in ("", "plain ascii", "Grüße aus München", "a \u2014 b"):
        assert repair_mojibake(text) == text


def test_does_not_mangle_legitimate_uppercase_a_tilde():
    # "Ã" alone is valid text; the heuristic must not rewrite it.
    text = "N\u00c3 is a letter"
    assert repair_mojibake(text) == text


def test_never_raises_on_unencodable_text():
    assert repair_mojibake("\u2011\u2019\u00e2\u20ac") is not None


def test_repair_payload_walks_structures():
    payload = {"answer": MOJIBAKE_CAFE, "items": [MOJIBAKE_HYPHEN, 3], "meta": {"n": None}}
    fixed = repair_payload(payload)
    assert fixed["answer"] == "caf\u00e9"
    assert fixed["items"][0] == "over\u2011the\u2011counter"
    assert fixed["items"][1] == 3
    assert fixed["meta"]["n"] is None
