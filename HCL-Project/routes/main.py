import os

from flask import Blueprint, jsonify, redirect

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def index():
    frontend_url = os.environ.get('FRONTEND_URL')
    if frontend_url:
        return redirect(frontend_url.rstrip('/'))
    return jsonify({
        'service': 'Urban Real Estate Intelligence API',
        'status': 'running',
        'docs': {
            'health': '/api/health',
            'summary': '/api/summary',
            'auth': '/api/auth/login',
        },
    })


@main_bp.route('/dashboard')
def dashboard():
    frontend_url = os.environ.get('FRONTEND_URL')
    if frontend_url:
        return redirect(frontend_url.rstrip('/'))
    return jsonify({'error': 'Frontend is deployed separately. Set FRONTEND_URL.'}), 404
