from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class UserDecision(Base):
    __tablename__ = "user_decisions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    league_id = Column(Integer, ForeignKey("leagues.id"), nullable=False)
    matchup_id = Column(Integer, ForeignKey("matchups.id"))
    
    # Decision details
    player_added_id = Column(Integer, ForeignKey("players.id"), nullable=False)
    player_dropped_id = Column(Integer, ForeignKey("players.id"))  # Nullable if no drop
    
    # Context at time of decision
    categories_targeted = Column(JSON)  # List of categories user was targeting
    category_needs = Column(JSON)  # How many of each category was needed
    matchup_context = Column(JSON)  # Winning/losing status, category standings
    
    # Outcome
    outcome = Column(String)  # 'win', 'loss', 'unknown'
    categories_won = Column(JSON)  # Which categories were won after this decision
    did_help = Column(Boolean)  # User feedback: did this help win categories?
    
    # Decision metadata
    decision_date = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="decisions")
    player_added = relationship("Player", foreign_keys=[player_added_id])
    player_dropped = relationship("Player", foreign_keys=[player_dropped_id])

