"""
Player Stats Service

Handles fetching and updating player statistics from NBA Stats API
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.player import Player, PlayerStats
from app.services.nba_api import NBAApiClient
from datetime import datetime


def update_player_stats(season: str = "2023-24"):
    """
    Update player statistics from NBA Stats API
    
    Args:
        season: Season string (e.g., '2023-24')
    """
    db = SessionLocal()
    nba_client = NBAApiClient()
    
    try:
        # Fetch player stats from NBA API
        nba_players = nba_client.get_player_stats(season=season)
        
        for nba_player in nba_players:
            # Find or create player
            player_name = nba_player.get("PLAYER_NAME")
            nba_player_id = nba_player.get("PLAYER_ID")
            
            if not player_name or not nba_player_id:
                continue
            
            # Check if player exists
            player = db.query(Player).filter(
                Player.nba_player_id == nba_player_id
            ).first()
            
            if not player:
                # Create new player
                player = Player(
                    name=player_name,
                    nba_player_id=nba_player_id,
                    position=nba_player.get("POSITION"),
                    team=nba_player.get("TEAM_ABBREVIATION")
                )
                db.add(player)
                db.flush()
            
            # Update or create player stats
            stats = db.query(PlayerStats).filter(
                PlayerStats.player_id == player.id,
                PlayerStats.season == season
            ).first()
            
            if not stats:
                stats = PlayerStats(
                    player_id=player.id,
                    season=season
                )
                db.add(stats)
            
            # Update stats
            stats.games_played = nba_player.get("GP", 0)
            stats.points = nba_player.get("PTS", 0.0)
            stats.rebounds = nba_player.get("REB", 0.0)
            stats.assists = nba_player.get("AST", 0.0)
            stats.steals = nba_player.get("STL", 0.0)
            stats.blocks = nba_player.get("BLK", 0.0)
            stats.threes_made = nba_player.get("FG3M", 0.0)
            stats.field_goals_made = nba_player.get("FGM", 0.0)
            stats.field_goals_attempted = nba_player.get("FGA", 0.0)
            stats.free_throws_made = nba_player.get("FTM", 0.0)
            stats.free_throws_attempted = nba_player.get("FTA", 0.0)
            
            # Calculate percentages
            if stats.field_goals_attempted > 0:
                stats.fg_percentage = stats.field_goals_made / stats.field_goals_attempted
            if stats.free_throws_attempted > 0:
                stats.ft_percentage = stats.free_throws_made / stats.free_throws_attempted
            
            # Calculate per-game averages
            if stats.games_played > 0:
                stats.points_per_game = stats.points / stats.games_played
                stats.rebounds_per_game = stats.rebounds / stats.games_played
                stats.assists_per_game = stats.assists / stats.games_played
                stats.steals_per_game = stats.steals / stats.games_played
                stats.blocks_per_game = stats.blocks / stats.games_played
                stats.threes_per_game = stats.threes_made / stats.games_played
            
            stats.updated_at = datetime.utcnow()
        
        db.commit()
        print(f"Updated stats for {len(nba_players)} players")
        
    except Exception as e:
        db.rollback()
        print(f"Error updating player stats: {e}")
        raise
    finally:
        db.close()
        nba_client.close()


if __name__ == "__main__":
    # Run as script to update stats
    update_player_stats()

