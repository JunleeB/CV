import os
import json
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Boolean,
    DateTime, ForeignKey, Text
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

load_dotenv()

# PostgreSQL 우선, 없으면 SQLite fallback
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://evuser:changeme@localhost:5432/annotation"
)

# SQLite URL이면 connect_args 추가 필요
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=3600,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    role = Column(String, default="annotator")
    created_at = Column(DateTime, default=datetime.utcnow)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    weights_path = Column(String, nullable=False)
    description = Column(String, nullable=True)
    is_base = Column(Boolean, default=False)  # 기본 모델은 삭제 불가
    task = Column(String, default="segment")   # "segment" | "detect"
    created_at = Column(DateTime, default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source_path = Column(String, nullable=True)
    conf_threshold = Column(Float, default=0.7)
    roi = Column(Text, nullable=True)
    model_id = Column(Integer, ForeignKey("model_versions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    labels = relationship("Label", back_populates="project", cascade="all, delete-orphan")
    images = relationship("Image", back_populates="project", cascade="all, delete-orphan", order_by="Image.filename")


class Label(Base):
    __tablename__ = "labels"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    name = Column(String, nullable=False)
    color = Column(String, default="#6366f1")
    class_index = Column(Integer, nullable=False)
    project = relationship("Project", back_populates="labels")


class Image(Base):
    __tablename__ = "images"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    filename = Column(String, nullable=False)
    rel_path = Column(String, nullable=False)
    status = Column(String, default="pending")
    project = relationship("Project", back_populates="images")
    annotations = relationship("Annotation", back_populates="image", cascade="all, delete-orphan")


class Annotation(Base):
    __tablename__ = "annotations"
    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False)
    label_id = Column(Integer, ForeignKey("labels.id"), nullable=False)
    polygon = Column(Text, nullable=False)
    confidence = Column(Float, nullable=True)
    is_auto = Column(Boolean, default=False)
    needs_review = Column(Boolean, default=False)
    image = relationship("Image", back_populates="annotations")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
