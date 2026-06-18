from datetime import datetime, timedelta, timezone

import jwt
from flask import current_app


def create_access_token(user_id, remember=False):
    if remember:
        expires = timedelta(days=current_app.config['JWT_REMEMBER_DAYS'])
    else:
        expires = timedelta(hours=current_app.config['JWT_EXPIRY_HOURS'])

    payload = {
        'sub': str(user_id),
        'exp': datetime.now(timezone.utc) + expires,
        'iat': datetime.now(timezone.utc),
    }
    return jwt.encode(payload, current_app.config['SECRET_KEY'], algorithm='HS256')


def decode_access_token(token):
    payload = jwt.decode(
        token,
        current_app.config['SECRET_KEY'],
        algorithms=['HS256'],
    )
    return int(payload['sub'])
