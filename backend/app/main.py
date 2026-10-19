from contextlib import asynccontextmanager
import time
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from backend.app.conversation_store import (
    create_conversation_if_missing,
    delete_conversation,
    get_messages,
    list_conversations,
    rename_conversation,
    save_exchange,
    save_message,
    conversation_belongs_to_user,
)
from backend.app.database import get_connection, initialize_database, transaction
from backend.app.admin_store import log_request
from backend.app.gems import GEMS
from backend.app.model_provider import generate_response, get_model_metadata
from backend.app.schemas import (
    ChatRequest,
    ChatResponse,
    ConversationMessagesResponse,
    ConversationsResponse,
    DeleteConversationResponse,
    GemInfo,
    GemsResponse,
    MockGoogleLoginRequest,
    RenameConversationRequest,
    RenameConversationResponse,
    SessionResponse,
    UserResponse,
    GoogleLoginRequest,
)
from backend.app.user_store import create_user_if_missing
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from backend.app import byok, providers
from backend.app.byok_api import router as byok_router
from backend.app.http_client import close_shared_session
from backend.app.middleware import (
    BodySizeLimitMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
)
from backend.app.rate_limit import auth_limiter, chat_limiter
from backend.app.settings import (
    GOOGLE_CLIENT_ID,
    IS_PRODUCTION,
    NOOR_BYOK_ENABLED,
    NOOR_EXTRA_ORIGINS,
    NOOR_INTELLIGENCE_ENABLED,
    NOOR_MAX_MESSAGE_CHARS,
)
from backend.app.task_queue import shutdown_pool
from backend.app.intelligence.api import router as intelligence_router
from backend.app.vitals import router as vitals_router
from backend.app.admin import router as admin_router
from backend.app.auth import (
    SessionIdentity,
    auth_enforced,
    clear_session_cookie,
    get_current_user,
    new_guest_id,
    resolve_user_id,
    set_session_cookie,
    sign_session,
)
from backend.app.concurrency import (
    check_and_increment_daily_usage,
    concurrency_slot,
    global_slot,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    if NOOR_INTELLIGENCE_ENABLED:
        # Best-effort: never block startup or fail the app on the memory layer.
        try:
            from backend.app.intelligence.vector_store import ensure_collections

            ensure_collections()
        except Exception as error:  # noqa: BLE001
            import logging

            logging.getLogger("noor").warning(
                "Intelligence vector store init skipped: %s", error
            )
    yield
    # Shutdown: release pooled sockets and background workers before teardown.
    shutdown_pool(wait=False)
    close_shared_session()
    # Close the embedded Qdrant client cleanly so qdrant-client's __del__ does
    # not raise during interpreter teardown.
    if NOOR_INTELLIGENCE_ENABLED:
        try:
            from backend.app.intelligence.vector_store import close as close_vector_store

            close_vector_store()
        except Exception:  # noqa: BLE001
            pass


app = FastAPI(
    title="Noor AI",
    description="Backend API for the Noor AI learning and intelligence platform.",
    version="0.1.0",
    lifespan=lifespan,
)

# Local dev origins are always allowed so a fresh clone works; production adds
# its public origin(s) via NOOR_ALLOWED_ORIGINS (comma separated). Never "*"
# with credentials — that combination is rejected by browsers and dangerous.
_ALLOWED_ORIGINS = sorted(
    {
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        # Phase 5: trusted local HTTPS (mkcert). Additive, so plain HTTP keeps
        # working; these only matter once the frontend is served over TLS.
        "https://127.0.0.1:3000",
        "https://localhost:3000",
        *NOOR_EXTRA_ORIGINS,
    }
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Let the browser read the intelligence layer's savings metadata.
    expose_headers=[
        "x-noor-memory-used",
        "x-noor-tokens-saved",
        "x-noor-cost-saved",
        "x-noor-cache-result",
        "x-noor-model-used",
    ],
)

app.include_router(intelligence_router)
app.include_router(vitals_router)
app.include_router(admin_router)
app.include_router(byok_router)

# Hardening middleware. Added innermost-first: the last added runs outermost, so
# request ids are assigned before anything else can log, and security headers are
# attached to every response (including 4xx/5xx produced by other middleware).
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestIdMiddleware)

@app.get("/")
def read_root():
    return {
        "app": "Noor AI",
        "message": "Noor AI backend is alive.",
        "status": "ok",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/ready")
def readiness_check():
    """Operational readiness: liveness plus the dependencies we actually need.

    Unlike ``/health`` (a pure liveness probe for load balancers) this reports
    whether the database is writable and BYOK is configured, so a deploy can be
    gated on real capability instead of process existence.
    """
    database_ok = True
    try:
        with get_connection() as connection:
            connection.execute("SELECT 1").fetchone()
    except Exception:  # noqa: BLE001
        database_ok = False
    return {
        "status": "ready" if database_ok else "degraded",
        "database": database_ok,
        "byok_enabled": NOOR_BYOK_ENABLED,
        "intelligence": NOOR_INTELLIGENCE_ENABLED,
        "environment": "production" if IS_PRODUCTION else "development",
    }


@app.get("/about")
def about_noor():
    return {
        "name": "Noor AI",
        "meaning": "Light",
        "mission": "Make advanced AI accessible to everyone.",
    }


@app.post("/auth/mock-google", response_model=UserResponse, dependencies=[Depends(auth_limiter())])
def mock_google_login(request: MockGoogleLoginRequest, response: Response):
    # The mock login trusts whatever email the client claims. That is a dev
    # convenience only — exposing it in production would be a full auth bypass.
    if IS_PRODUCTION:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    user_id = f"google:{request.email.lower()}"

    user = create_user_if_missing(
        user_id=user_id,
        email=request.email.lower(),
        name=request.name,
        avatar_url=request.avatar_url,
        provider="google",
    )
    set_session_cookie(
        response,
        sign_session(
            user_id=user["user_id"],
            provider="google",
            email=user["email"],
            name=user["name"],
            avatar_url=user["avatar_url"],
        ),
    )
    return user


def create_title_from_message(message: str) -> str:
    title = message.strip()

    if len(title) > 60:
        return f"{title[:57]}..."

    return title


def raise_unknown_conversation() -> None:
    raise HTTPException(
        status_code=404,
        detail={
            "error": "Unknown conversation_id",
        },
    )

def ensure_conversation_owner(conversation_id: str, user_id: str) -> None:
    if not conversation_belongs_to_user(conversation_id, user_id):
        raise_unknown_conversation()


@app.post("/chat", response_model=ChatResponse, dependencies=[Depends(chat_limiter())])
def chat(request: ChatRequest, session: SessionIdentity | None = Depends(get_current_user)):
    user_id = resolve_user_id(session, request.user_id)
    gem = GEMS.get(request.gem_id)

    if gem is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "Unknown gem_id",
                "available_gems": list(GEMS.keys()),
            },
        )
    if len(request.message) > NOOR_MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "message_too_long",
                "message": f"Messages are limited to {NOOR_MAX_MESSAGE_CHARS} characters.",
            },
        )

    # Resolve the route *before* doing any work: an unusable model choice is a
    # clear 409/404, not a mid-generation failure.
    try:
        route = byok.resolve_route(user_id, request.model)
    except byok.ByokError as error:
        raise HTTPException(
            status_code=error.status,
            detail={"error": error.code, "message": str(error)},
        ) from error

    conversation_id = request.conversation_id or str(uuid4())
    check_and_increment_daily_usage(user_id)
    _t0 = time.perf_counter()
    try:
        # use_route() makes every nested LLM call (including none-down here)
        # carry the user's own key when one is selected.
        with providers.use_route(route):
            with concurrency_slot(user_id), global_slot():
                if route is not None:
                    result = providers.chat_completion(
                        [
                            {"role": "system", "content": gem["system_prompt"]},
                            {"role": "user", "content": request.message},
                        ],
                        route,
                    )
                    ai_response = result.content
                    byok.touch_used(user_id, route.provider)
                else:
                    ai_response = generate_response(request.message, gem)
    except providers.ProviderError as error:
        raise HTTPException(
            status_code=error.status,
            detail={"error": "model_provider_error", "message": str(error)},
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Model provider error",
                "message": str(error),
            },
        ) from error
    latency_ms = int((time.perf_counter() - _t0) * 1000)
    conversation_title = create_title_from_message(request.message)
    if route is not None:
        model_metadata = {"provider": route.provider, "model": route.model}
    else:
        model_metadata = get_model_metadata()

    # One write transaction for the whole turn: conversation, both messages and
    # the analytics row. SQLite has a single writer, so batching commits is the
    # difference between ~65 and several hundred req/s under load.
    with transaction() as connection:
        save_exchange(
            conversation_id=conversation_id,
            user_id=user_id,
            title=conversation_title,
            gem_id=request.gem_id,
            user_content=request.message,
            assistant_content=ai_response,
            connection=connection,
        )
        # Best-effort: log_request swallows its own errors and never raises.
        log_request(
            user_id=user_id,
            conversation_id=conversation_id,
            gem_id=request.gem_id,
            source="chat",
            question=request.message,
            response=ai_response,
            provider=model_metadata["provider"],
            model=model_metadata["model"],
            latency_ms=latency_ms,
            connection=connection,
        )
    return {
        "conversation_id": conversation_id,
        "gem_id": request.gem_id,
        "gem_name": gem["name"],
        "message": request.message,
        "response": ai_response,
        "provider": model_metadata["provider"],
        "model": model_metadata["model"],
    }


@app.get("/gems", response_model=GemsResponse)
def list_gems():
    return {"gems": GEMS}


@app.get("/gems/{gem_id}", response_model=GemInfo)
def get_gem(gem_id: str):
    gem = GEMS.get(gem_id)

    if gem is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "Unknown gem_id",
                "available_gems": list(GEMS.keys()),
            },
        )

    return gem


@app.get(
    "/conversations/{conversation_id}/messages",
    response_model=ConversationMessagesResponse,
)
def list_conversation_messages(
    conversation_id: str,
    user_id: str = "local_user",
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    ensure_conversation_owner(conversation_id, user_id)

    return {
        "conversation_id": conversation_id,
        "messages": get_messages(conversation_id),
    }

@app.get("/conversations", response_model=ConversationsResponse)
def get_conversations(
    user_id: str = "local_user",
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    return {"conversations": list_conversations(user_id)}


@app.patch(
    "/conversations/{conversation_id}",
    response_model=RenameConversationResponse,
)
def update_conversation_title(
    conversation_id: str,
    request: RenameConversationRequest,
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, request.user_id)
    ensure_conversation_owner(conversation_id, user_id)
    renamed = rename_conversation(conversation_id, request.title)

    if not renamed:
        raise_unknown_conversation()

    return {
        "conversation_id": conversation_id,
        "title": request.title,
    }


@app.delete(
    "/conversations/{conversation_id}",
    response_model=DeleteConversationResponse,
)
def remove_conversation(
    conversation_id: str,
    user_id: str = "local_user",
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    ensure_conversation_owner(conversation_id, user_id)
    deleted = delete_conversation(conversation_id)

    if not deleted:
        raise_unknown_conversation()

    return {
        "conversation_id": conversation_id,
        "deleted": True,
    }

@app.post("/auth/google", response_model=UserResponse, dependencies=[Depends(auth_limiter())])
def google_login(request: GoogleLoginRequest, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Google auth is not configured",
            },
        )

    try:
        token_info = id_token.verify_oauth2_token(
            request.credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "Invalid Google credential",
            },
        ) from error

    email = token_info["email"].lower()
    name = token_info.get("name", email)
    avatar_url = token_info.get("picture")
    google_subject = token_info["sub"]

    user = create_user_if_missing(
        user_id=f"google:{google_subject}",
        email=email,
        name=name,
        avatar_url=avatar_url,
        provider="google",
    )
    set_session_cookie(
        response,
        sign_session(
            user_id=user["user_id"],
            provider="google",
            email=user["email"],
            name=user["name"],
            avatar_url=user["avatar_url"],
        ),
    )
    return user


@app.post("/auth/guest", response_model=UserResponse, dependencies=[Depends(auth_limiter())])
def guest_login(request: Request, response: Response):
    """Mint a signed *guest* session so even anonymous identity is unforgeable.

    Idempotent: if the caller already holds a valid session we return it as-is
    rather than minting a fresh guest id (which would orphan their history).
    """
    existing = get_current_user(request)
    if existing is not None:
        return {
            "user_id": existing.user_id,
            "email": existing.email or "",
            "name": existing.name or ("Guest" if existing.is_guest else existing.user_id),
            "avatar_url": existing.avatar_url,
            "provider": existing.provider,
        }

    guest_id = new_guest_id()
    set_session_cookie(
        response, sign_session(user_id=guest_id, provider="guest", name="Guest")
    )
    return {
        "user_id": guest_id,
        "email": "",
        "name": "Guest",
        "avatar_url": None,
        "provider": "guest",
    }


@app.get("/auth/me", response_model=SessionResponse)
def whoami(session: SessionIdentity | None = Depends(get_current_user)):
    if session is None:
        return SessionResponse(authenticated=False, enforce=auth_enforced())
    return SessionResponse(
        authenticated=True,
        enforce=auth_enforced(),
        user_id=session.user_id,
        provider=session.provider,
        email=session.email,
        name=session.name,
        avatar_url=session.avatar_url,
        is_guest=session.is_guest,
    )


@app.post("/auth/logout")
def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}
