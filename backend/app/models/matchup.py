from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Matchup(Base):
    __tablename__ = "matchups"

    id = Column(Integer, primary_key=True, index=True)
    league_id = Column(Integer, ForeignKey("leagues.id"), nullable=False)
    user_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    opponent_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    
    week = Column(Integer, nullable=False)
    season = Column(String, nullable=False)  # e.g., '2023-24'
    
    # Matchup status
    status = Column(String, default="upcoming")  # 'upcoming', 'live', 'completed'
    start_date = Column(DateTime(timezone=True))
    end_date = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    league = relationship("League")
    user_team = relationship("Team", foreign_keys=[user_team_id])
    opponent_team = relationship("Team", foreign_keys=[opponent_team_id])
    category_standings = relationship("CategoryStanding", back_populates="matchup", cascade="all, delete-orphan")


class CategoryStanding(Base):
    __tablename__ = "category_standings"

    id = Column(Integer, primary_key=True, index=True)
    matchup_id = Column(Integer, ForeignKey("matchups.id"), nullable=False)
    
    category = Column(String, nullable=False)  # 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG%', 'FT%', '3PM'
    user_total = Column(Float, default=0.0)
    opponent_total = Column(Float, default=0.0)
    
    # Calculated fields
    user_lead = Column(Float, default=0.0)  # user_total - opponent_total
    is_winning = Column(String)  # 'winning', 'losing', 'tied'
    
    # Snapshot timestamp for real-time updates
    snapshot_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    matchup = relationship("Matchup", back_populates="category_standings")

