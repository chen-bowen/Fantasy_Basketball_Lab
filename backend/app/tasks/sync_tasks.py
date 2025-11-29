"""
Celery tasks for league synchronization
"""
from celery import Celery
from app.database import SessionLocal
from app.models.league import League
from app.services.yahoo_api import YahooAPIClient
from app.services.espn_scraper import ESPNScraper
import os
from dotenv import load_dotenv

load_dotenv()

# Celery configuration
celery_app = Celery(
    "category_edge",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://localhost:6379/0")
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)


@celery_app.task(name="sync_league")
def sync_league_task(league_id: int):
    """
    Sync a league's data from Yahoo/ESPN
    
    Args:
        league_id: Database ID of the league to sync
    """
    db = SessionLocal()
    try:
        league = db.query(League).filter(League.id == league_id).first()
        if not league:
            return {"status": "error", "message": "League not found"}
        
        # Update sync status
        league.sync_status = "syncing"
        db.commit()
        
        try:
            if league.platform == "yahoo":
                # Sync Yahoo league
                yahoo_client = YahooAPIClient(
                    oauth_token=league.oauth_token or "",
                    oauth_token_secret=league.oauth_token_secret or ""
                )
                
                # Get league data
                league_data = yahoo_client.get_league(league.platform_league_id)
                teams_data = yahoo_client.get_league_teams(league.platform_league_id)
                
                # TODO: Process and store league data
                # - Update teams
                # - Update rosters
                # - Update matchups
                # - Update category standings
                
            elif league.platform == "espn":
                # Sync ESPN league (requires credentials)
                # TODO: Get ESPN credentials from secure storage
                # espn_scraper = ESPNScraper(username="", password="")
                # league_data = espn_scraper.get_league_data(league.platform_league_id, "2024")
                pass
            
            # Update sync status to success
            league.sync_status = "success"
            db.commit()
            
            return {"status": "success", "league_id": league_id}
            
        except Exception as e:
            # Update sync status to error
            league.sync_status = "error"
            league.sync_error = str(e)
            db.commit()
            return {"status": "error", "message": str(e)}
            
    finally:
        db.close()


@celery_app.task(name="sync_all_leagues")
def sync_all_leagues_task():
    """Sync all leagues that need syncing"""
    db = SessionLocal()
    try:
        # Get all active leagues
        leagues = db.query(League).filter(League.sync_status != "syncing").all()
        
        for league in leagues:
            sync_league_task.delay(league.id)
        
        return {"status": "success", "leagues_queued": len(leagues)}
    finally:
        db.close()

