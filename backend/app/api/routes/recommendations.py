from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from app.database import get_db
from app.models.user import User
from app.api.routes.auth import get_current_user

router = APIRouter()


class PlayerRecommendation(BaseModel):
    player_id: int
    player_name: str
    position: str
    category_impact: dict
    games_remaining: int
    reasoning: str
    match_score: float


@router.get("/{league_id}")
def get_recommendations(
    league_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get streaming recommendations for a league"""
    # TODO: Implement recommendation logic
    # For now, return empty list
    return {
        "recommendations": [],
        "league_id": league_id,
        "message": "Recommendations coming soon"
    }

