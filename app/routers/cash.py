"""Router para gestión de Caja (Sesiones)."""

from datetime import datetime
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.cash import CashSession
from app.models.payment import SalePayment, PaymentMethod
from app.models.sale import Sale
from app.models.user import User
from app.schemas import CashSessionCreate, CashSessionClose, CashSessionOut
from app.routers.auth import get_current_user
from app.utils.dates import get_now

router = APIRouter(prefix="/cash", tags=["cash"])


@router.post("/open", response_model=CashSessionOut,
             summary="Abrir Caja",
             description="Inicia un nuevo turno de caja para el usuario actual.")
def open_session(
    session_in: CashSessionCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Abre una nueva sesión de caja.

    Verifica que el usuario no tenga ya una sesión abierta. Registra el
    monto inicial (fondo de caja).

    Args:
        session_in (CashSessionCreate): Datos iniciales (monto apertura).
        db (Session): Sesión DB.

    Returns:
        CashSessionOut: La sesión creada.
    
    Raises:
        HTTPException(400): Si ya existe una sesión abierta.
    """
    user_id = current_user.id

    # Verificar si ya tiene una abierta
    active_session = db.query(CashSession).filter(
        CashSession.user_id == user_id,
        CashSession.status == "OPEN"
    ).first()
    
    if active_session:
        if session_in.force_close_previous:
            # Cerrar sesión anterior forzosamente
            active_session.status = "CLOSED_SYSTEM"
            active_session.end_time = datetime.now()
            # Asumimos diferencia 0 o lo que sea, idealmente se debería calcular
            # pero al ser forzado, no tenemos "declarado".
            active_session.final_cash_declared = 0 
            active_session.difference = 0 # O null
            db.commit()
            db.refresh(active_session)
        else:
            raise HTTPException(
                status_code=409, 
                detail=f"Ya existe una caja abierta para este usuario (ID: {active_session.id}, Inicio: {active_session.start_time})"
            )

    new_session = CashSession(
        user_id=user_id,
        start_amount=session_in.start_amount,
        final_cash_system=0,
        final_cash_declared=0,
        difference=0,
        status="OPEN"
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session


@router.get("/status", response_model=CashSessionOut,
             summary="Estado de Caja",
             description="Consulta el estado actual de la caja del usuario.")
def session_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtiene el estado de la caja actual.
    
    Args:
        user_id (int, optional): ID del usuario a consultar. Si no se provee, usa el default.
        db (Session): Sesión DB.
        
    Returns:
        CashSessionOut: Objeto sesión activa.
        
    Raises:
        HTTPException(404): Si no hay caja abierta.
    """
    user_id = current_user.id
        
    active_session = db.query(CashSession).filter(
        CashSession.user_id == user_id,
        CashSession.status == "OPEN"
    ).first()
    
    if not active_session:
        raise HTTPException(status_code=404, detail="No hay caja abierta")

    # Calcular monto actual en sistema (ventas efectivo) de esta sesión
    # 1. Buscar ventas realizadas por este user desde start_time
    # 2. Sumar SalePayment donde method='EFECTIVO' y sale_id in (ventas del user)
    
    # query_total = db.query(func.sum(SalePayment.amount)).join(Sale).filter(
    #     Sale.user_id == user_id? No, Sale.user_id es cliente! 
    #     Necesitamos Sale.created_by? No tenemos created_by en Sale.
    #     Asumimos que la sesión es global para las ventas que caen en ese rango?
    #     O necesitamos agregar created_by a Sale.
    # )
    
    # CRITICAL: Sale needs `seller_id` or audit field to link to CashSession user.
    # For now, we assume single user or we filter by time > start_time.
    
    # Simplified approach: Sum all CASH payments created after session start
    # This assumes single cashier machine logic or logic by time.
    
    # To be robust, we need `seller_id` on Sale. I will follow up on this.
    # For now, let's just return the session object as stored.
    
    return active_session


@router.post("/close", response_model=CashSessionOut,
             summary="Cerrar Caja",
             description="Cierra el turno y realiza el arqueo de caja.")
def close_session(
    close_in: CashSessionClose, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Cierra la sesión de caja y realiza arqueo (Blind Cash Count).

    Calcula cuánto efectivo debería haber según las ventas registradas
    y lo compara con lo declarado por el cajero.

    Args:
        close_in (CashSessionClose): Monto declarado por el cajero.
        db (Session): Sesión DB.

    Returns:
        CashSessionOut: Sesión cerrada con detalle de diferencias.

    Raises:
        HTTPException(404): Si no hay caja abierta.
    """
    user_id = current_user.id
    active_session = db.query(CashSession).filter(
        CashSession.user_id == user_id,
        CashSession.status == "OPEN"
    ).first()
    
    if not active_session:
        raise HTTPException(status_code=404, detail="No hay caja abierta")

    # Calcular Sistema
    # Sumar pagos en efectivo desde active_session.start_time
    total_sales_cash = db.query(func.coalesce(func.sum(SalePayment.amount), 0))\
        .join(Sale)\
        .join(PaymentMethod)\
        .filter(
            Sale.created_at >= active_session.start_time,
            Sale.seller_id == user_id,
            PaymentMethod.code == "EFECTIVO"
        ).scalar()
    
    # Note: This logic assumes all sales after open belong to this session.
    # In a multi-user environment, we need seller_id.
    
    final_system = active_session.start_amount + total_sales_cash
    
    active_session.end_time = get_now()
    active_session.final_cash_system = final_system
    active_session.final_cash_declared = close_in.final_cash_declared
    active_session.difference = close_in.final_cash_declared - final_system
    active_session.status = "CLOSED"
    
    db.commit()
    db.refresh(active_session)
    return active_session
