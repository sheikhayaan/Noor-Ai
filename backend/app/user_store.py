from backend.app.database import get_connection


def create_user_if_missing(
    user_id: str,
    email: str,
    name: str,
    avatar_url: str | None,
    provider: str,
) -> dict:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO users (user_id, email, name, avatar_url, provider)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, email, name, avatar_url, provider),
        )

        cursor = connection.execute(
            """
            SELECT user_id, email, name, avatar_url, provider
            FROM users
            WHERE user_id = ?
            """,
            (user_id,),
        )

        row = cursor.fetchone()

        return {
            "user_id": row[0],
            "email": row[1],
            "name": row[2],
            "avatar_url": row[3],
            "provider": row[4],
        }
