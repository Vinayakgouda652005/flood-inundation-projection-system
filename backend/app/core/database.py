
import logging
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from app.core.config import settings


logger = logging.getLogger("flood_backend.database")


def normalize_database_url(database_url: str) -> str:
    """
    Normalize supported PostgreSQL URLs for SQLAlchemy.

    Supports:
    - postgresql://
    - postgres://
    - postgresql+psycopg2://
    """
    if not database_url or not database_url.strip():
        raise RuntimeError(
            "DATABASE_URL is empty. Configure it in backend/.env."
        )

    database_url = database_url.strip()

    if database_url.startswith("postgres://"):
        database_url = database_url.replace(
            "postgres://",
            "postgresql+psycopg2://",
            1,
        )
    elif database_url.startswith("postgresql://"):
        database_url = database_url.replace(
            "postgresql://",
            "postgresql+psycopg2://",
            1,
        )

    try:
        parsed_url = make_url(database_url)
    except Exception as exc:
        raise RuntimeError(
            "DATABASE_URL is invalid. Check the connection string "
            "in backend/.env."
        ) from exc

    if parsed_url.drivername not in {
        "postgresql",
        "postgresql+psycopg2",
    }:
        raise RuntimeError(
            "This application requires PostgreSQL. "
            "Set DATABASE_URL to a PostgreSQL connection string."
        )

    if not parsed_url.database:
        raise RuntimeError(
            "DATABASE_URL must include a database name."
        )

    return database_url


# Load the PostgreSQL URL from application settings.
db_url = normalize_database_url(settings.DATABASE_URL)

try:
    engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
        connect_args={"connect_timeout": 10},
    )
except Exception as exc:
    # Do not log the complete URL because it may contain a password.
    logger.exception(
        "Failed to initialize the PostgreSQL SQLAlchemy engine."
    )
    raise RuntimeError(
        "Could not initialize the PostgreSQL engine. "
        "Check backend/.env, your database URL, and installed driver."
    ) from exc


SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    Provide one SQLAlchemy session per FastAPI request.
    Always close the session after the request finishes.
    """
    db = SessionLocal()

    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def check_database_connection() -> None:
    """
    Verify that PostgreSQL is reachable using the configured URL.
    """
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        logger.info("PostgreSQL connection verified successfully.")

    except OperationalError as exc:
        logger.error(
            "Unable to connect to PostgreSQL. "
            "Verify the server, database name, host, port, and credentials."
        )
        raise RuntimeError(
            "PostgreSQL is unreachable. Check backend/.env and ensure "
            "the PostgreSQL server is running."
        ) from exc


def init_db() -> None:
    """
    Register model metadata and create missing database tables.

    Existing tables and data are not migrated automatically.
    Use a database migration for schema changes.
    """
    try:
        # Import models so SQLAlchemy registers their table metadata.
        import app.models  # noqa: F401

        check_database_connection()
        Base.metadata.create_all(bind=engine)

        logger.info(
            "PostgreSQL database connection verified and "
            "missing tables initialized successfully."
        )

    except (OperationalError, SQLAlchemyError) as exc:
        logger.exception(
            "Failed to initialize PostgreSQL database tables."
        )
        raise RuntimeError(
            "Database initialization failed. Check the PostgreSQL "
            "connection and database permissions."
        ) from exc


def close_database_connection() -> None:
    """
    Dispose of pooled database connections during application shutdown.
    """
    engine.dispose()
    logger.info("PostgreSQL connection pool disposed.")
