"""
League Sync Service

Handles synchronization of league data from Yahoo/ESPN
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.league import League, Team
from app.models.matchup import Matchup, CategoryStanding
from app.models.league import Roster
from app.models.player import Player
from app.services.yahoo_api import YahooAPIClient
from app.services.espn_scraper import ESPNScraper
from datetime import datetime


def sync_yahoo_league(db: Session, league: League):
    """
    Sync a Yahoo league
    
    Args:
        db: Database session
        league: League model instance
    """
    try:
        yahoo_client = YahooAPIClient(
            oauth_token=league.oauth_token or "",
            oauth_token_secret=league.oauth_token_secret or ""
        )
        
        # Get league data
        league_data = yahoo_client.get_league(league.platform_league_id)
        teams_data = yahoo_client.get_league_teams(league.platform_league_id)
        
        # Process teams
        for team_data in teams_data:
            platform_team_id = team_data.get("team_key", "").split(".t.")[-1]
            team_name = team_data.get("name", "")
            is_user_team = team_data.get("is_owned_by_current_login", 0) == 1
            
            # Find or create team
            team = db.query(Team).filter(
                Team.league_id == league.id,
                Team.platform_team_id == platform_team_id
            ).first()
            
            if not team:
                team = Team(
                    league_id=league.id,
                    platform_team_id=platform_team_id,
                    name=team_name,
                    is_user_team=is_user_team
                )
                db.add(team)
                db.flush()
            
            # Get roster
            roster_data = yahoo_client.get_team_roster(team_data.get("team_key", ""))
            
            # Update roster
            # Clear existing roster snapshot
            db.query(Roster).filter(Roster.team_id == team.id).delete()
            
            for player_data in roster_data:
                player_name = player_data.get("name", {}).get("full", "")
                platform_player_id = player_data.get("player_id", "")
                
                # Find player
                player = db.query(Player).filter(
                    Player.platform_player_id == platform_player_id
                ).first()
                
                if player:
                    roster = Roster(
                        team_id=team.id,
                        player_id=player.id,
                        position=player_data.get("selected_position", {}).get("position", ""),
                        is_bench=player_data.get("selected_position", {}).get("position") == "BN"
                    )
                    db.add(roster)
        
        # Get matchups
        matchups_data = yahoo_client.get_league_matchups(league.platform_league_id)
        
        # Process matchups
        for matchup_data in matchups_data:
            # TODO: Process matchup data and update CategoryStanding
            pass
        
        # Update sync timestamp
        league.last_synced_at = datetime.utcnow()
        league.sync_status = "success"
        db.commit()
        
    except Exception as e:
        league.sync_status = "error"
        league.sync_error = str(e)
        db.commit()
        raise


def sync_espn_league(db: Session, league: League, username: str, password: str):
    """
    Sync an ESPN league
    
    Args:
        db: Database session
        league: League model instance
        username: ESPN username
        password: ESPN password
    """
    try:
        scraper = ESPNScraper(username=username, password=password)
        
        if not scraper.login():
            raise Exception("Failed to login to ESPN")
        
        # Get league data
        league_data = scraper.get_league_data(
            league.platform_league_id,
            "2024"  # TODO: Get current season
        )
        
        # TODO: Process league data similar to Yahoo sync
        
        scraper.close()
        
        # Update sync timestamp
        league.last_synced_at = datetime.utcnow()
        league.sync_status = "success"
        db.commit()
        
    except Exception as e:
        league.sync_status = "error"
        league.sync_error = str(e)
        db.commit()
        raise

