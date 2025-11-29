.PHONY: install dev migrate run celery test clean

# Install dependencies
install:
	uv sync

# Run development server
dev:
	uv run uvicorn app.main:app --reload

# Run Celery worker
celery:
	uv run celery -A app.tasks.sync_tasks.celery_app worker --loglevel=info

# Run database migrations
migrate:
	uv run alembic upgrade head

# Create new migration
migrate-create:
	uv run alembic revision --autogenerate -m "$(msg)"

# Run tests (when implemented)
test:
	uv run pytest

# Clean up
clean:
	rm -rf __pycache__ .pytest_cache .mypy_cache
	find . -type d -name __pycache__ -exec rm -r {} +
	find . -type f -name "*.pyc" -delete

# Update dependencies
update:
	uv sync --upgrade

