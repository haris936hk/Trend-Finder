"""DB-backed endpoint for the singleton scan settings row (lookback window)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Settings
from app.schemas import SettingsOut, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    db_settings = db.query(Settings).first()
    if db_settings is None:
        raise HTTPException(status_code=404, detail="Settings not found.")
    return db_settings


@router.put("", response_model=SettingsOut)
def update_settings(settings: SettingsUpdate, db: Session = Depends(get_db)):
    db_settings = db.query(Settings).first()
    if db_settings is None:
        raise HTTPException(status_code=404, detail="Settings not found.")

    db_settings.lookback_months = settings.lookback_months
    db.commit()
    db.refresh(db_settings)
    return db_settings
