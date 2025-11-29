"""
NBA Stats API Client

Free public API for NBA player statistics and live game data
Documentation: https://www.nba.com/stats/help/api
"""
import httpx
from typing import Dict, List, Optional
from datetime import datetime


class NBAApiClient:
    """Client for NBA Stats API"""
    
    BASE_URL = "https://stats.nba.com/stats"
    
    def __init__(self):
        self.client = httpx.Client(
            timeout=30.0,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.nba.com/",
            }
        )
    
    def get_player_stats(self, season: str = "2023-24", per_mode: str = "PerGame") -> List[Dict]:
        """
        Get player statistics for a season
        
        Args:
            season: Season string (e.g., '2023-24')
            per_mode: 'PerGame' or 'Totals'
        
        Returns:
            List of player stat dictionaries
        """
        endpoint = "/leaguedashplayerstats"
        params = {
            "Season": season,
            "PerMode": per_mode,
            "MeasureType": "Base",
            "SeasonType": "Regular Season",
        }
        
        try:
            response = self.client.get(f"{self.BASE_URL}{endpoint}", params=params)
            response.raise_for_status()
            data = response.json()
            
            # Parse response
            headers = data["resultSets"][0]["headers"]
            rows = data["resultSets"][0]["rowSet"]
            
            players = []
            for row in rows:
                player = dict(zip(headers, row))
                players.append(player)
            
            return players
        except Exception as e:
            print(f"Error fetching player stats: {e}")
            return []
    
    def get_live_boxscore(self, game_id: str) -> Dict:
        """
        Get live boxscore for a game
        
        Args:
            game_id: NBA game ID
        
        Returns:
            Boxscore dictionary
        """
        endpoint = "/boxscoretraditionalv2"
        params = {
            "GameID": game_id,
        }
        
        try:
            response = self.client.get(f"{self.BASE_URL}{endpoint}", params=params)
            response.raise_for_status()
            data = response.json()
            
            # Parse response
            return data
        except Exception as e:
            print(f"Error fetching boxscore: {e}")
            return {}
    
    def get_active_games(self, game_date: Optional[str] = None) -> List[Dict]:
        """
        Get list of active games
        
        Args:
            game_date: Date string (YYYY-MM-DD), defaults to today
        
        Returns:
            List of game dictionaries
        """
        if not game_date:
            game_date = datetime.now().strftime("%Y-%m-%d")
        
        endpoint = "/scoreboard"
        params = {
            "GameDate": game_date,
            "LeagueID": "00",
            "DayOffset": "0",
        }
        
        try:
            response = self.client.get(f"{self.BASE_URL}{endpoint}", params=params)
            response.raise_for_status()
            data = response.json()
            
            # Parse response
            games = data.get("resultSets", [{}])[0].get("rowSet", [])
            return games
        except Exception as e:
            print(f"Error fetching active games: {e}")
            return []
    
    def get_player_game_log(self, player_id: int, season: str = "2023-24") -> List[Dict]:
        """
        Get game log for a specific player
        
        Args:
            player_id: NBA player ID
            season: Season string
        
        Returns:
            List of game log dictionaries
        """
        endpoint = "/playergamelog"
        params = {
            "PlayerID": player_id,
            "Season": season,
            "SeasonType": "Regular Season",
        }
        
        try:
            response = self.client.get(f"{self.BASE_URL}{endpoint}", params=params)
            response.raise_for_status()
            data = response.json()
            
            # Parse response
            headers = data["resultSets"][0]["headers"]
            rows = data["resultSets"][0]["rowSet"]
            
            games = []
            for row in rows:
                game = dict(zip(headers, row))
                games.append(game)
            
            return games
        except Exception as e:
            print(f"Error fetching player game log: {e}")
            return []
    
    def close(self):
        """Close HTTP client"""
        self.client.close()

