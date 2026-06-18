import os
from dotenv import load_dotenv

load_dotenv()


def get_database_url():
    url = os.environ.get('DATABASE_URL', 'sqlite:///database.db')
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url


def get_cors_origins():
    origins = os.environ.get(
        'FRONTEND_URL',
        'https://urei-chi.vercel.app',
    )
    return [origin.strip() for origin in origins.split(',') if origin.strip()]


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'change-me-in-production')
    SQLALCHEMY_DATABASE_URI = get_database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MIGRATION_DIR = 'migrations'

    FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://urei-chi.vercel.app')
    AUTO_CREATE_DB = os.environ.get('AUTO_CREATE_DB', 'true').lower() == 'true'
    JWT_EXPIRY_HOURS = int(os.environ.get('JWT_EXPIRY_HOURS', '24'))
    JWT_REMEMBER_DAYS = int(os.environ.get('JWT_REMEMBER_DAYS', '30'))

    @staticmethod
    def init_app(app):
        pass


class ProductionConfig(Config):
    DEBUG = False

    @staticmethod
    def init_app(app):
        Config.init_app(app)


class DevelopmentConfig(Config):
    DEBUG = True


config_by_name = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig,
}
