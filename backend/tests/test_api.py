from fastapi.testclient import TestClient

from backend.app.main import app
from uuid import uuid4
from backend.app import http_client
from backend.app.database import initialize_database


client = TestClient(app)
initialize_database()


def test_health_check():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_list_gems():
    response = client.get("/gems")

    assert response.status_code == 200
    assert "gems" in response.json()
    assert "tutor" in response.json()["gems"]
    assert "system_prompt" not in response.json()["gems"]["tutor"]
    assert response.json()["gems"]["tutor"]["category"] == "learning"


def test_chat_with_valid_gem():
    response = client.post(
        "/chat",
        json={
            "message": "Explain gravity",
            "gem_id": "tutor",
        },
    )

    assert response.status_code == 200
    assert response.json()["gem_id"] == "tutor"
    assert response.json()["gem_name"] == "Tutor Gem"
    assert "system_prompt" not in response.json()


def test_chat_with_unknown_gem():
    response = client.post(
        "/chat",
        json={
            "message": "Hello",
            "gem_id": "unknown",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "Unknown gem_id"


def test_tutor_gem_has_tutor_style_response():
    response = client.post(
        "/chat",
        json={
            "message": "Explain gravity",
            "gem_id": "tutor",
        },
    )

    assert response.status_code == 200
    assert "step by step" in response.json()["response"]

def test_chat_defaults_to_general_gem():
    response = client.post(
        "/chat",
        json={
            "message": "Hello Noor",
        },
    )

    assert response.status_code == 200
    assert response.json()["gem_id"] == "general"
    assert response.json()["gem_name"] == "General Noor"
    assert "response" in response.json()


def test_chat_rejects_empty_message():
    response = client.post(
        "/chat",
        json={
            "message": "",
            "gem_id": "tutor",
        },
    )

    assert response.status_code == 422

def test_get_single_gem():
    response = client.get("/gems/tutor")

    assert response.status_code == 200
    assert response.json()["name"] == "Tutor Gem"
    assert response.json()["category"] == "learning"
    assert "system_prompt" not in response.json()


def test_get_unknown_single_gem():
    response = client.get("/gems/unknown")

    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "Unknown gem_id"


def test_new_gems_are_available():
    response = client.get("/gems")

    assert response.status_code == 200
    gems = response.json()["gems"]
    assert gems["image"]["name"] == "Image Prompt Gem"
    assert gems["image"]["category"] == "image"
    assert gems["business"]["name"] == "Business Gem"
    assert gems["business"]["category"] == "business"


def test_chat_with_image_and_business_gems():
    for gem_id, gem_name in (("image", "Image Prompt Gem"), ("business", "Business Gem")):
        response = client.post(
            "/chat",
            json={"message": "A neon city at night", "gem_id": gem_id},
        )

        assert response.status_code == 200
        assert response.json()["gem_id"] == gem_id
        assert response.json()["gem_name"] == gem_name


def test_chat_creates_conversation_id_when_missing():
    response = client.post(
        "/chat",
        json={
            "message": "Hello Noor",
        },
    )

    assert response.status_code == 200
    assert response.json()["conversation_id"]


def test_chat_keeps_existing_conversation_id():
    response = client.post(
        "/chat",
        json={
            "message": "Continue",
            "conversation_id": "conv_123",
        },
    )

    assert response.status_code == 200
    assert response.json()["conversation_id"] == "conv_123"

def test_chat_saves_messages_to_conversation():
    conversation_id = f"conv_test_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "Remember this",
            "gem_id": "general",
            "conversation_id": conversation_id,
        },
    )

    assert chat_response.status_code == 200

    messages_response = client.get(f"/conversations/{conversation_id}/messages")

    assert messages_response.status_code == 200
    assert len(messages_response.json()["messages"]) == 2
    assert messages_response.json()["messages"][0]["role"] == "user"
    assert messages_response.json()["messages"][1]["role"] == "assistant"
    assert "id" in messages_response.json()["messages"][0]
    assert "created_at" in messages_response.json()["messages"][0]


def test_list_conversations_includes_saved_conversation():
    conversation_id = f"conv_list_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "List me later",
            "conversation_id": conversation_id,
        },
    )

    assert chat_response.status_code == 200

    response = client.get("/conversations")

    assert response.status_code == 200
    conversation_ids = [
        conversation["conversation_id"]
        for conversation in response.json()["conversations"]
    ]
    assert conversation_id in conversation_ids

def test_list_conversations_includes_title_and_gem_id():
    conversation_id = f"conv_title_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "Explain gravity for class 8",
            "gem_id": "tutor",
            "conversation_id": conversation_id,
        },
    )

    assert chat_response.status_code == 200

    response = client.get("/conversations")

    assert response.status_code == 200

    matching_conversations = [
        conversation
        for conversation in response.json()["conversations"]
        if conversation["conversation_id"] == conversation_id
    ]

    assert len(matching_conversations) == 1
    assert matching_conversations[0]["title"] == "Explain gravity for class 8"
    assert matching_conversations[0]["gem_id"] == "tutor"
    assert matching_conversations[0]["last_message_at"]

def test_conversation_title_is_truncated_for_long_message():
    conversation_id = f"conv_long_title_{uuid4()}"
    long_message = "A" * 100

    chat_response = client.post(
        "/chat",
        json={
            "message": long_message,
            "conversation_id": conversation_id,
        },
    )

    assert chat_response.status_code == 200

    response = client.get("/conversations")

    matching_conversations = [
        conversation
        for conversation in response.json()["conversations"]
        if conversation["conversation_id"] == conversation_id
    ]

    assert len(matching_conversations) == 1
    assert len(matching_conversations[0]["title"]) == 60
    assert matching_conversations[0]["title"].endswith("...")

def test_rename_conversation():
    conversation_id = f"conv_rename_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "Original title",
            "conversation_id": conversation_id,
        },
    )

    assert chat_response.status_code == 200

    rename_response = client.patch(
        f"/conversations/{conversation_id}",
        json={
            "title": "Renamed conversation",
        },
    )

    assert rename_response.status_code == 200
    assert rename_response.json()["conversation_id"] == conversation_id
    assert rename_response.json()["title"] == "Renamed conversation"

    list_response = client.get("/conversations")
    conversations = list_response.json()["conversations"]

    matching_conversations = [
        conversation
        for conversation in conversations
        if conversation["conversation_id"] == conversation_id
    ]

    assert len(matching_conversations) == 1
    assert matching_conversations[0]["title"] == "Renamed conversation"


def test_rename_unknown_conversation_returns_404():
    response = client.patch(
        "/conversations/missing",
        json={
            "title": "Does not exist",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "Unknown conversation_id"


def test_rename_conversation_rejects_empty_title():
    response = client.patch(
        "/conversations/missing",
        json={
            "title": "",
        },
    )

    assert response.status_code == 422

def test_delete_conversation_removes_conversation_and_messages():
    conversation_id = f"conv_delete_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "Delete me later",
            "conversation_id": conversation_id,
        },
    )

    assert chat_response.status_code == 200

    delete_response = client.delete(f"/conversations/{conversation_id}")

    assert delete_response.status_code == 200
    assert delete_response.json()["conversation_id"] == conversation_id
    assert delete_response.json()["deleted"] is True

    list_response = client.get("/conversations")
    conversation_ids = [
        conversation["conversation_id"]
        for conversation in list_response.json()["conversations"]
    ]

    assert conversation_id not in conversation_ids

    messages_response = client.get(f"/conversations/{conversation_id}/messages")

    assert messages_response.status_code == 404
    assert messages_response.json()["detail"]["error"] == "Unknown conversation_id"


def test_delete_unknown_conversation_returns_404():
    response = client.delete("/conversations/missing")

    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "Unknown conversation_id"

def test_fake_model_provider_returns_gem_specific_response():
    response = client.post(
        "/chat",
        json={
            "message": "Explain photosynthesis",
            "gem_id": "tutor",
        },
    )

    assert response.status_code == 200
    assert "step by step" in response.json()["response"]

def test_unknown_model_provider_returns_clean_error(monkeypatch):
    monkeypatch.setattr("backend.app.model_provider.MODEL_PROVIDER", "unknown")

    response = client.post(
        "/chat",
        json={
            "message": "Hello",
            "gem_id": "general",
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["error"] == "Model provider error"
    assert "Unsupported model provider" in response.json()["detail"]["message"]

def test_openai_provider_without_api_key_returns_clean_error(monkeypatch):
    monkeypatch.setattr("backend.app.model_provider.MODEL_PROVIDER", "openai")
    monkeypatch.setattr("backend.app.model_provider.OPENAI_API_KEY", None)

    response = client.post(
        "/chat",
        json={
            "message": "Hello",
            "gem_id": "general",
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["error"] == "Model provider error"
    assert "OPENAI_API_KEY is required" in response.json()["detail"]["message"]


def test_openai_provider_failure_returns_clean_error(monkeypatch):
    class FakeCompletions:
        def create(self, *args, **kwargs):
            raise RuntimeError("network down")

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAIClient:
        chat = FakeChat()

    def fake_openai(*args, **kwargs):
        return FakeOpenAIClient()

    monkeypatch.setattr("backend.app.model_provider.MODEL_PROVIDER", "openai")
    monkeypatch.setattr("backend.app.model_provider.OPENAI_API_KEY", "fake-key")
    monkeypatch.setattr("backend.app.model_provider.OpenAI", fake_openai)

    response = client.post(
        "/chat",
        json={
            "message": "Hello",
            "gem_id": "general",
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["error"] == "Model provider error"
    assert "OpenAI request failed" in response.json()["detail"]["message"]


def test_conversations_are_filtered_by_user_id():
    user_a = f"user_a_{uuid4()}"
    user_b = f"user_b_{uuid4()}"

    response_a = client.post(
        "/chat",
        json={
            "message": "User A private chat",
            "conversation_id": f"conv_a_{uuid4()}",
            "user_id": user_a,
        },
    )
    response_b = client.post(
        "/chat",
        json={
            "message": "User B private chat",
            "conversation_id": f"conv_b_{uuid4()}",
            "user_id": user_b,
        },
    )

    assert response_a.status_code == 200
    assert response_b.status_code == 200

    list_a = client.get(f"/conversations?user_id={user_a}")
    list_b = client.get(f"/conversations?user_id={user_b}")

    titles_a = [conversation["title"] for conversation in list_a.json()["conversations"]]
    titles_b = [conversation["title"] for conversation in list_b.json()["conversations"]]

    assert "User A private chat" in titles_a
    assert "User B private chat" not in titles_a
    assert "User B private chat" in titles_b
    assert "User A private chat" not in titles_b

def test_chat_response_includes_model_metadata():
    response = client.post(
        "/chat",
        json={
            "message": "Hello",
            "gem_id": "general",
        },
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "fake"
    assert response.json()["model"] == "fake-noor-v1"

def test_user_cannot_read_another_users_conversation_messages():
    owner_id = f"owner_{uuid4()}"
    attacker_id = f"attacker_{uuid4()}"
    conversation_id = f"private_conv_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "Secret conversation",
            "conversation_id": conversation_id,
            "user_id": owner_id,
        },
    )

    assert chat_response.status_code == 200

    owner_response = client.get(
        f"/conversations/{conversation_id}/messages?user_id={owner_id}"
    )
    attacker_response = client.get(
        f"/conversations/{conversation_id}/messages?user_id={attacker_id}"
    )

    assert owner_response.status_code == 200
    assert len(owner_response.json()["messages"]) == 2
    assert attacker_response.status_code == 404
    assert attacker_response.json()["detail"]["error"] == "Unknown conversation_id"

def test_user_cannot_rename_another_users_conversation():
    owner_id = f"owner_{uuid4()}"
    attacker_id = f"attacker_{uuid4()}"
    conversation_id = f"rename_private_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "Private rename target",
            "conversation_id": conversation_id,
            "user_id": owner_id,
        },
    )

    assert chat_response.status_code == 200

    response = client.patch(
        f"/conversations/{conversation_id}",
        json={
            "title": "Stolen title",
            "user_id": attacker_id,
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "Unknown conversation_id"

def test_user_cannot_delete_another_users_conversation():
    owner_id = f"owner_{uuid4()}"
    attacker_id = f"attacker_{uuid4()}"
    conversation_id = f"delete_private_{uuid4()}"

    chat_response = client.post(
        "/chat",
        json={
            "message": "Private delete target",
            "conversation_id": conversation_id,
            "user_id": owner_id,
        },
    )

    assert chat_response.status_code == 200

    response = client.delete(
        f"/conversations/{conversation_id}?user_id={attacker_id}"
    )

    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "Unknown conversation_id"

    owner_messages = client.get(
        f"/conversations/{conversation_id}/messages?user_id={owner_id}"
    )

    assert owner_messages.status_code == 200
    assert len(owner_messages.json()["messages"]) == 2


def test_google_login_returns_user(monkeypatch):
    monkeypatch.setattr("backend.app.main.GOOGLE_CLIENT_ID", "client-id")

    def fake_verify_oauth2_token(credential, request, audience):
        return {
            "sub": "google-sub-123",
            "email": "SHEIKH@EXAMPLE.COM",
            "name": "Sheikh User",
            "picture": "https://example.com/avatar.png",
        }

    monkeypatch.setattr(
        "backend.app.main.id_token.verify_oauth2_token",
        fake_verify_oauth2_token,
    )

    response = client.post(
        "/auth/google",
        json={
            "credential": "fake-google-token",
        },
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == "google:google-sub-123"
    assert response.json()["email"] == "sheikh@example.com"
    assert response.json()["name"] == "Sheikh User"
    assert response.json()["provider"] == "google"

def test_google_login_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr("backend.app.main.GOOGLE_CLIENT_ID", "client-id")

    def fake_verify_oauth2_token(credential, request, audience):
        raise ValueError("bad token")

    monkeypatch.setattr(
        "backend.app.main.id_token.verify_oauth2_token",
        fake_verify_oauth2_token,
    )

    response = client.post(
        "/auth/google",
        json={
            "credential": "fake-google-token",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "Invalid Google credential"


def test_google_login_requires_google_client_id(monkeypatch):
    monkeypatch.setattr("backend.app.main.GOOGLE_CLIENT_ID", None)

    response = client.post(
        "/auth/google",
        json={
            "credential": "fake-google-token",
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["error"] == "Google auth is not configured"


def test_gateway_provider_forwards_request_to_gateway(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "model": "downstream-model-xyz",
                "provider": "some-real-provider",
                "choices": [
                    {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "Gateway routed answer"}}
                ],
            }

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return FakeResponse()

    monkeypatch.setattr("backend.app.model_provider.MODEL_PROVIDER", "gateway")
    monkeypatch.setattr(http_client.shared_session(), "post", fake_post)

    response = client.post(
        "/chat",
        json={"message": "Explain semantic caching", "gem_id": "general"},
    )

    assert response.status_code == 200
    assert response.json()["response"] == "Gateway routed answer"
    # Routing is invisible: the user sees the gateway, never the downstream model.
    assert response.json()["provider"] == "noor-gateway"
    assert response.json()["model"] == "noor-auto"

    assert captured["url"].endswith("/v1/chat/completions")
    assert captured["headers"]["Authorization"].startswith("Bearer ")
    assert captured["json"]["model"] == "noor-auto"
    assert captured["json"]["messages"][0]["role"] == "system"
    assert captured["json"]["messages"][1]["content"] == "Explain semantic caching"


def test_gateway_provider_unreachable_returns_clean_error(monkeypatch):
    import requests as _requests

    def fake_post(*args, **kwargs):
        raise _requests.exceptions.ConnectionError("connection refused")

    monkeypatch.setattr("backend.app.model_provider.MODEL_PROVIDER", "gateway")
    monkeypatch.setattr(http_client.shared_session(), "post", fake_post)

    response = client.post(
        "/chat",
        json={"message": "Hello", "gem_id": "general"},
    )

    assert response.status_code == 500
    assert response.json()["detail"]["error"] == "Model provider error"
    assert "Cannot reach Noor Gateway" in response.json()["detail"]["message"]


def test_gateway_provider_upstream_error_returns_clean_error(monkeypatch):
    class FakeResponse:
        status_code = 402

        def json(self):
            return {"error": {"message": "budget_exceeded"}}

    def fake_post(*args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr("backend.app.model_provider.MODEL_PROVIDER", "gateway")
    monkeypatch.setattr(http_client.shared_session(), "post", fake_post)

    response = client.post(
        "/chat",
        json={"message": "Hello", "gem_id": "general"},
    )

    assert response.status_code == 500
    assert response.json()["detail"]["error"] == "Model provider error"
    assert "402" in response.json()["detail"]["message"]
    assert "budget_exceeded" in response.json()["detail"]["message"]
