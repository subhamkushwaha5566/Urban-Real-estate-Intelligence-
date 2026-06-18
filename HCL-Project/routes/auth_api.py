from functools import wraps

from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError

from extensions import db
from models.user import User
from utils.auth_tokens import create_access_token, decode_access_token

auth_api_bp = Blueprint('auth_api', __name__, url_prefix='/api/auth')


def get_bearer_token():
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:].strip()
    return None


def login_required_api(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        token = get_bearer_token()
        if not token:
            return jsonify({'error': 'Authentication required'}), 401
        try:
            user_id = decode_access_token(token)
        except Exception:
            return jsonify({'error': 'Invalid or expired token'}), 401

        user = User.query.get(user_id)
        if not user or not user.is_active:
            return jsonify({'error': 'User not found'}), 401

        return view(user, *args, **kwargs)

    return wrapped


def user_payload(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
    }


@auth_api_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}

    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    password2 = data.get('password2') or password

    errors = {}
    if len(username) < 3:
        errors['username'] = 'Username must be at least 3 characters.'
    if len(email) < 6 or '@' not in email:
        errors['email'] = 'Please enter a valid email address.'
    if len(password) < 6:
        errors['password'] = 'Password must be at least 6 characters.'
    if password != password2:
        errors['password2'] = 'Passwords must match.'
    if errors:
        return jsonify({'error': 'Validation failed', 'fields': errors}), 400

    user = User(username=username, email=email)
    user.set_password(password)

    try:
        db.session.add(user)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Username or email already exists'}), 409

    token = create_access_token(user.id)
    return jsonify({
        'message': 'Registration successful',
        'token': token,
        'user': user_payload(user),
    }), 201


@auth_api_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}

    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    remember = bool(data.get('remember_me'))

    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({'error': 'Invalid username or password'}), 401

    token = create_access_token(user.id, remember=remember)
    return jsonify({
        'token': token,
        'user': user_payload(user),
    })


@auth_api_bp.route('/me', methods=['GET'])
@login_required_api
def me(user):
    return jsonify({'user': user_payload(user)})


@auth_api_bp.route('/logout', methods=['POST'])
def logout():
    return jsonify({'message': 'Logged out'})
