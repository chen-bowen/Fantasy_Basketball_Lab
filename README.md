# Category Edge - AI-Powered Fantasy Basketball Streaming Assistant

An AI-powered tool for making optimal daily streaming decisions in fantasy basketball category leagues.

## Features

- **Auto-Sync Leagues**: Connect Yahoo and ESPN leagues automatically
- **AI Recommendations**: Personalized streaming recommendations that learn from your decisions
- **Real-Time Updates**: Live category standings during games
- **Optimal Add/Drop Pairs**: AI suggests who to add AND who to drop
- **Mid-Game Breakout Alerts**: Push notifications for breakout performances

## Tech Stack

### Frontend
- Next.js 14 (App Router)
- TypeScript
- TailwindCSS

### Backend
- FastAPI (Python)
- PostgreSQL
- Redis
- Celery (background tasks)

### APIs
- Yahoo Fantasy Sports API (free)
- NBA Stats API (free)
- ESPN (web scraping)

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 15+ (or Docker)
- Redis 7+ (or Docker)
- Docker Desktop (recommended for easiest setup)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd fantasy_ring
   ```

2. **Set up frontend**
   ```bash
   npm install
   ```

3. **Set up backend**
   ```bash
   # Install uv if not already installed
   curl -LsSf https://astral.sh/uv/install.sh | sh
   # Or with pip: pip install uv
   
   cd backend
   # uv will create a virtual environment automatically
   uv sync
   ```

4. **Set up environment variables**
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your configuration
   ```

5. **Set up Docker (if using Docker Compose)**
   
   **Ensure Docker is available:**
   ```bash
   # Run setup script to add Docker to PATH
   ./scripts/setup-docker-path.sh
   source ~/.zshrc  # or ~/.bash_profile
   
   # Or ensure Docker is running (auto-starts if installed)
   ./scripts/docker-ensure.sh
   ```
   
   **Install Docker Desktop (if not installed):**
   ```bash
   # Option 1: Homebrew
   brew install --cask docker
   
   # Option 2: Download from website
   # Visit: https://www.docker.com/products/docker-desktop/
   ```
   
   **Installation:** Download from https://www.docker.com/products/docker-desktop/ or `brew install --cask docker`

6. **Set up database**
   
   **Option A: Using Docker Compose (recommended)**
   ```bash
   # Ensure Docker is running
   ./scripts/docker-ensure.sh
   
   # Start services:
   docker compose up -d db redis
   
   # Or start everything (backend + celery + db + redis):
   docker compose up -d
   
   # See DOCKER_SETUP.md for detailed Docker instructions
   ```
   
   **Option B: Manual Setup (if Docker is not available)**
   
   **PostgreSQL:**
   ```bash
   # Install PostgreSQL (macOS with Homebrew)
   brew install postgresql@15
   brew services start postgresql@15
   
   # Create database
   createdb category_edge
   
   # Or using psql
   psql postgres
   CREATE DATABASE category_edge;
   \q
   ```
   
   **Redis:**
   ```bash
   # Install Redis (macOS with Homebrew)
   brew install redis
   brew services start redis
   
   # Verify Redis is running
   redis-cli ping
   # Should return: PONG
   ```
   
   **Update .env file:**
   ```bash
   # Edit backend/.env and set:
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/category_edge
   REDIS_URL=redis://localhost:6379/0
   ```

7. **Run database migrations**
   ```bash
   cd backend
   uv run alembic upgrade head
   # Or: make migrate
   ```

8. **Start development servers**

   Terminal 1 - Backend:
   ```bash
   cd backend
   uv run uvicorn app.main:app --reload
   ```

   Terminal 2 - Celery Worker:
   ```bash
   cd backend
   uv run celery -A app.tasks.sync_tasks.celery_app worker --loglevel=info
   ```

   Terminal 3 - Frontend:
   ```bash
   npm run dev
   ```

8. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

## Quick Start with Docker (Recommended)

```bash
# 1. Ensure Docker is in PATH (one-time setup)
./scripts/setup-docker-path.sh
source ~/.zshrc

# 2. Ensure Docker is running
./scripts/docker-ensure.sh

# 3. Start all services
docker compose up -d

# 4. Run migrations
docker compose exec backend uv run alembic upgrade head

# 5. Access the app
# Frontend: http://localhost:3000
# Backend: http://localhost:8000/docs
```

## Project Structure

```
fantasy_ring/
├── app/                    # Next.js frontend
│   ├── page.tsx          # Home page
│   ├── login/            # Login page
│   └── dashboard/        # Dashboard page
├── backend/               # FastAPI backend
│   ├── app/
│   │   ├── api/          # API routes
│   │   ├── models/       # Database models
│   │   ├── services/     # Business logic
│   │   └── tasks/        # Celery tasks
│   └── alembic/          # Database migrations
└── docker-compose.yml     # Docker setup
```

## Development

### Running Tests
```bash
# Backend tests (when implemented)
cd backend
pytest

# Frontend tests (when implemented)
npm test
```

### Database Migrations
```bash
cd backend
# Create new migration
uv run alembic revision --autogenerate -m "description"

# Apply migrations
uv run alembic upgrade head

# Or use Makefile
make migrate-create msg="description"
make migrate
```

## License

MIT

