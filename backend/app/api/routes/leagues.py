from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from app.database import get_db
from app.models.user import User
from app.models.league import League, Team
from app.api.routes.auth import get_current_user
from app.services.yahoo_api import YahooAPIClient

router = APIRouter()


class LeagueCreate(BaseModel):
    platform: str
    platform_league_id: str
    name: str
    oauth_token: Optional[str] = None
    oauth_token_secret: Optional[str] = None


class LeagueResponse(BaseModel):
    id: int
    platform: str
    platform_league_id: str
    name: str
    league_type: Optional[str]
    sync_status: str
    last_synced_at: Optional[str]

    class Config:
        from_attributes = True


@router.get("/", response_model=List[LeagueResponse])
def get_leagues(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all leagues for the current user"""
    leagues = db.query(League).filter(League.user_id == current_user.id).all()
    return leagues


@router.post("/", response_model=LeagueResponse)
def create_league(
    league_data: LeagueCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new league connection"""
    # Check if league already exists for this user
    existing = db.query(League).filter(
        League.user_id == current_user.id,
        League.platform == league_data.platform,
        League.platform_league_id == league_data.platform_league_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="League already connected"
        )
    
    league = League(
        user_id=current_user.id,
        platform=league_data.platform,
        platform_league_id=league_data.platform_league_id,
        name=league_data.name,
        oauth_token=league_data.oauth_token,
        oauth_token_secret=league_data.oauth_token_secret,
        sync_status="pending"
    )
    db.add(league)
    db.commit()
    db.refresh(league)
    return league


@router.get("/{league_id}", response_model=LeagueResponse)
def get_league(
    league_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific league"""
    league = db.query(League).filter(
        League.id == league_id,
        League.user_id == current_user.id
    ).first()
    
    if not league:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="League not found"
        )
    
    return league


@router.post("/{league_id}/sync")
def sync_league(
    league_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Trigger a manual sync for a league"""
    league = db.query(League).filter(
        League.id == league_id,
        League.user_id == current_user.id
    ).first()
    
    if not league:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="League not found"
        )
    
    # TODO: Trigger Celery task for league sync
    # For now, just update status
    league.sync_status = "syncing"
    db.commit()
    
    return {"message": "Sync started", "league_id": league_id}

