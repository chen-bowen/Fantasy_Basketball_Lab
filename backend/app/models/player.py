from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    
    # Player identification
    name = Column(String, nullable=False, index=True)
    platform_player_id = Column(String, index=True)  # Yahoo/ESPN player ID
    nba_player_id = Column(Integer, index=True)  # NBA Stats API player ID
    
    # Player info
    position = Column(String)  # 'PG', 'SG', 'SF', 'PF', 'C'
    team = Column(String)  # NBA team abbreviation
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    stats = relationship("PlayerStats", back_populates="player", cascade="all, delete-orphan")
    rosters = relationship("Roster", back_populates="player")


class PlayerStats(Base):
    __tablename__ = "player_stats"

    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False)
    
    # Season stats (category league)
    season = Column(String, nullable=False)  # e.g., '2023-24'
    
    # Category stats
    games_played = Column(Integer, default=0)
    points = Column(Float, default=0.0)
    rebounds = Column(Float, default=0.0)
    assists = Column(Float, default=0.0)
    steals = Column(Float, default=0.0)
    blocks = Column(Float, default=0.0)
    threes_made = Column(Float, default=0.0)
    field_goals_made = Column(Float, default=0.0)
    field_goals_attempted = Column(Float, default=0.0)
    free_throws_made = Column(Float, default=0.0)
    free_throws_attempted = Column(Float, default=0.0)
    
    # Calculated percentages
    fg_percentage = Column(Float)
    ft_percentage = Column(Float)
    
    # Per-game averages
    points_per_game = Column(Float)
    rebounds_per_game = Column(Float)
    assists_per_game = Column(Float)
    steals_per_game = Column(Float)
    blocks_per_game = Column(Float)
    threes_per_game = Column(Float)
    
    # Last N games stats (for recent form)
    last_7_games = Column(JSON)  # Store recent game stats
    last_14_games = Column(JSON)
    
    # Update timestamp
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    player = relationship("Player", back_populates="stats")

