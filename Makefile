.PHONY: help install setup-docker docker-up docker-down docker-logs migrate dev test clean

help: ## Show this help message
	@echo "Category Edge - Makefile Commands"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies (frontend + backend)
	npm install
	cd backend && uv sync

setup-docker: ## Set up Docker in PATH
	./scripts/setup-docker-path.sh
	@echo "✅ Run: source ~/.zshrc (or restart terminal)"

docker-ensure: ## Ensure Docker is available and running
	./scripts/docker-ensure.sh

docker-up: ## Start all Docker services
	./scripts/docker-ensure.sh
	docker compose up -d

docker-down: ## Stop all Docker services
	docker compose down

docker-logs: ## View Docker logs (follow mode)
	docker compose logs -f

docker-build: ## Rebuild Docker containers
	docker compose build

migrate: ## Run database migrations
	cd backend && uv run alembic upgrade head

migrate-create: ## Create a new migration (usage: make migrate-create MSG="description")
	cd backend && uv run alembic revision --autogenerate -m "$(MSG)"

dev-backend: ## Start backend development server (local)
	cd backend && uv run uvicorn app.main:app --reload

dev-celery: ## Start Celery worker (local)
	cd backend && uv run celery -A app.tasks.sync_tasks.celery_app worker --loglevel=info

dev-frontend: ## Start frontend development server
	npm run dev

test: ## Run tests (when implemented)
	cd backend && uv run pytest

clean: ## Clean up generated files
	find . -type d -name __pycache__ -exec rm -r {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	rm -rf .next node_modules/.cache
	@echo "✅ Cleaned up generated files"



