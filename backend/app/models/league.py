from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, JSON, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class League(Base):
    __tablename__ = "leagues"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    platform = Column(String, nullable=False)  # 'yahoo' or 'espn'
    platform_league_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    league_type = Column(String)  # 'category' or 'points'
    
    # OAuth tokens (encrypted in production)
    oauth_token = Column(String)
    oauth_token_secret = Column(String)
    refresh_token = Column(String)
    
    # Sync metadata
    last_synced_at = Column(DateTime(timezone=True))
    sync_status = Column(String, default="pending")  # 'pending', 'syncing', 'success', 'error'
    sync_error = Column(String)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="leagues")
    teams = relationship("Team", back_populates="league", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    league_id = Column(Integer, ForeignKey("leagues.id"), nullable=False)
    platform_team_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    is_user_team = Column(Boolean, default=False)  # True if this is the user's team
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    league = relationship("League", back_populates="teams")
    rosters = relationship("Roster", back_populates="team", cascade="all, delete-orphan")


class Roster(Base):
    __tablename__ = "rosters"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False)
    position = Column(String)  # 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'
    is_bench = Column(Boolean, default=False)
    
    # Snapshot timestamp
    snapshot_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    team = relationship("Team", back_populates="rosters")
    player = relationship("Player", back_populates="rosters")

