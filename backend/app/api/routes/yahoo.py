"""
Yahoo OAuth and API routes
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.api.routes.auth import get_current_user
from app.services.yahoo_api import YahooOAuth

router = APIRouter()


@router.get("/authorize")
def authorize_yahoo(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Initiate Yahoo OAuth flow"""
    oauth = YahooOAuth()
    auth_url = oauth.get_authorization_url()
    
    # TODO: Store request token in session/cache for later verification
    # For now, redirect to Yahoo
    return RedirectResponse(url=auth_url)


@router.get("/callback")
def yahoo_callback(
    oauth_verifier: str,
    oauth_token: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Handle Yahoo OAuth callback"""
    oauth = YahooOAuth()
    
    try:
        # Exchange verifier for access token
        tokens = oauth.get_access_token(oauth_verifier, oauth_token)
        
        # TODO: Store tokens in database for the user
        # TODO: Fetch user's leagues and create League records
        
        return {
            "status": "success",
            "message": "Yahoo account connected successfully"
        }
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to connect Yahoo account: {str(e)}"
        )

