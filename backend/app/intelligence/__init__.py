"""Noor Intelligence Layer.

The persistent-memory + token-reduction system that sits between Noor AI's chat
endpoint and Noor Gateway. All embedding and caching still happen in the
gateway; this package adds per-user semantic memory (Qdrant), style/affinity
profiles (SQLite), and honest savings accounting on top.
"""
