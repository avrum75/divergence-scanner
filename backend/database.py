from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# Create SQLite database
# Fix: use absolute path based on this file's location to avoid CWD issues
# Database is in the backend directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
SQLITE_URL = f"sqlite:///{os.path.join(BACKEND_DIR, 'divergence.db')}"

# connect_args={"check_same_thread": False} is needed for SQLite
engine = create_engine(
    SQLITE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
