import os

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import config_by_name, get_cors_origins
from extensions import db, migrate, login_manager


def create_app(config_name=None):
    if config_name is None:
        config_name = os.environ.get('FLASK_CONFIG', 'development')

    app = Flask(__name__)
    config_class = config_by_name.get(config_name, config_by_name['default'])
    app.config.from_object(config_class)
    config_class.init_app(app)

    CORS(
        app,
        resources={r"/api/*": {"origins": get_cors_origins()}},
        methods=['GET', 'POST', 'OPTIONS'],
        allow_headers=['Content-Type', 'Authorization'],
        expose_headers=['Content-Type'],
    )

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)

    from routes.main import main_bp
    from routes.api import api_bp
    from routes.auth_api import auth_api_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(auth_api_bp)

    if app.config.get('AUTO_CREATE_DB', True):
        with app.app_context():
            try:
                db.create_all()
            except Exception:
                app.logger.exception('Database initialization failed')

    @app.errorhandler(404)
    def not_found(error):
        if request.path.startswith('/api/'):
            return jsonify({'error': 'API route not found'}), 404
        return jsonify({'error': 'Route not found'}), 404

    @app.errorhandler(Exception)
    def unhandled_error(error):
        if isinstance(error, HTTPException):
            return jsonify({'error': error.description}), error.code

        app.logger.exception('Unhandled request error')
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Internal server error'}), 500
        return jsonify({'error': 'Internal server error'}), 500

    return app


if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_CONFIG', 'development') != 'production'
    app.run(host='0.0.0.0', port=port, debug=debug)
