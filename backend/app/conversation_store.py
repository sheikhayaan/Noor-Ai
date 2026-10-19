from backend.app.database import get_connection, transaction


def save_message(conversation_id: str, role: str, content: str) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO messages (conversation_id, role, content)
            VALUES (?, ?, ?)
            """,
            (conversation_id, role, content),
        )
        connection.execute(
            """
            UPDATE conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE conversation_id = ?
            """,
            (conversation_id,),
        )


def get_messages(conversation_id: str) -> list[dict]:
    with get_connection() as connection:
        cursor = connection.execute(
            """
            SELECT id, role, content, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            """,
            (conversation_id,),
        )

        return [
            {
                "id": row[0],
                "role": row[1],
                "content": row[2],
                "created_at": row[3],
            }
            for row in cursor.fetchall()
        ]


def list_conversations(user_id: str) -> list[dict]:
    with get_connection() as connection:
        cursor = connection.execute(
            """
            SELECT conversation_id, user_id, title, gem_id, updated_at
            FROM conversations
            WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (user_id,),
        )

        return [
            {
                "conversation_id": row[0],
                "user_id": row[1],
                "title": row[2],
                "gem_id": row[3],
                "last_message_at": row[4],
            }
            for row in cursor.fetchall()
        ]


def create_conversation_if_missing(
    conversation_id: str,
    user_id: str,
    title: str,
    gem_id: str,
) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO conversations (conversation_id, user_id, title, gem_id)
            VALUES (?, ?, ?, ?)
            """,
            (conversation_id, user_id, title, gem_id),
        )


def save_exchange(
    conversation_id: str,
    user_id: str,
    title: str,
    gem_id: str,
    user_content: str,
    assistant_content: str,
    *,
    connection=None,
) -> None:
    """Persist a whole turn (conversation + both messages) in one commit.

    This is the hot path: one write transaction instead of four. ``connection``
    lets a caller fold the analytics insert into the same transaction.
    """

    def _apply(link) -> None:
        link.execute(
            """
            INSERT OR IGNORE INTO conversations (conversation_id, user_id, title, gem_id)
            VALUES (?, ?, ?, ?)
            """,
            (conversation_id, user_id, title, gem_id),
        )
        link.executemany(
            """
            INSERT INTO messages (conversation_id, role, content)
            VALUES (?, ?, ?)
            """,
            [
                (conversation_id, "user", user_content),
                (conversation_id, "assistant", assistant_content),
            ],
        )
        link.execute(
            """
            UPDATE conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE conversation_id = ?
            """,
            (conversation_id,),
        )

    if connection is not None:
        _apply(connection)
        return
    with transaction() as link:
        _apply(link)


def rename_conversation(conversation_id: str, title: str) -> bool:
    with get_connection() as connection:
        cursor = connection.execute(
            """
            UPDATE conversations
            SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE conversation_id = ?
            """,
            (title, conversation_id),
        )

        return cursor.rowcount > 0

def delete_conversation(conversation_id: str) -> bool:
    with get_connection() as connection:
        cursor = connection.execute(
            """
            DELETE FROM conversations
            WHERE conversation_id = ?
            """,
            (conversation_id,),
        )

        if cursor.rowcount == 0:
            return False

        connection.execute(
            """
            DELETE FROM messages
            WHERE conversation_id = ?
            """,
            (conversation_id,),
        )

        return True


def conversation_belongs_to_user(conversation_id: str, user_id: str) -> bool:
    with get_connection() as connection:
        cursor = connection.execute(
            """
            SELECT 1
            FROM conversations
            WHERE conversation_id = ? AND user_id = ?
            """,
            (conversation_id, user_id),
        )

        return cursor.fetchone() is not None


def get_conversation_owner(conversation_id: str) -> str | None:
    """Return the owning user_id for a conversation, or None if it doesn't exist.

    Used by the intelligence chat route to reject a client-supplied
    conversation_id that belongs to a *different* user (data isolation) while
    still allowing brand-new conversation_ids to be created.
    """
    with get_connection() as connection:
        cursor = connection.execute(
            "SELECT user_id FROM conversations WHERE conversation_id = ?",
            (conversation_id,),
        )
        row = cursor.fetchone()
        return row[0] if row else None