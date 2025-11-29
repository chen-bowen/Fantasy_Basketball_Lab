# Setup Guide

## Installation Steps

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Install Backend Dependencies

```bash
cd backend
uv sync
```

### 3. Set Up Environment Variables

```bash
cd backend
cp .env.example .env
# Edit .env with your database credentials
```

### 4. Set Up Database

**Option A: Using Supabase (Recommended - Free Cloud Database)**

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. Wait for the database to be provisioned (takes ~2 minutes)
4. Go to **Settings** → **Database**
5. Find your **Connection string** under "Connection string" → "URI"
6. Copy the connection string and update `backend/.env`:
   ```bash
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres?sslmode=require
   ```
   Replace `[YOUR-PASSWORD]` with your database password (shown when you create the project)
   Replace `[YOUR-PROJECT-REF]` with your project reference ID

**Benefits of Supabase:**

- ✅ Free tier: 500MB database, 2GB bandwidth
- ✅ Managed PostgreSQL (no local setup needed)
- ✅ Automatic backups
- ✅ Web dashboard for database management
- ✅ Works from anywhere (no Docker/local DB required)

**Option B: Using Docker (Local Development)**

```bash
# Ensure Docker is available
./scripts/setup-docker-path.sh
source ~/.zshrc

# Start database services
./scripts/docker-ensure.sh
docker compose up -d db redis

# Create database (if needed)
docker compose exec db psql -U postgres -c "CREATE DATABASE category_edge;"
```

**Option C: Manual Local Setup**

```bash
# PostgreSQL (macOS)
brew install postgresql@15
brew services start postgresql@15
createdb category_edge

# Redis (macOS)
brew install redis
brew services start redis

# Update backend/.env:
# DATABASE_URL=postgresql://your_user@localhost:5432/category_edge
# REDIS_URL=redis://localhost:6379/0
```

### 5. Run Database Migrations

```bash
cd backend
uv run alembic upgrade head
```

### 6. Start Development Servers

**Using Docker:**

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f backend
```

**Manual:**

```bash
# Terminal 1 - Backend
cd backend
uv run uvicorn app.main:app --reload

# Terminal 2 - Celery Worker
cd backend
uv run celery -A app.tasks.sync_tasks.celery_app worker --loglevel=info

# Terminal 3 - Frontend
npm run dev
```

## Troubleshooting

### Database Connection Issues

- **Supabase**: Verify DATABASE_URL in `backend/.env` includes `?sslmode=require`
- **Docker**: Check PostgreSQL is running: `docker compose ps`
- **Docker**: Use `db` as hostname in DATABASE_URL, not `localhost`
- **Local**: Check PostgreSQL is running: `pg_isready`
- Verify DATABASE_URL format is correct in `backend/.env`

### Redis Connection Issues

- Check Redis is running: `redis-cli ping`
- Verify REDIS_URL in `backend/.env`

### Docker Issues

- Ensure Docker Desktop is running
- Run: `./scripts/docker-ensure.sh`
- Check: `docker compose ps`

### Python Import Errors

- Make sure virtual environment is active: `uv run python ...`
- Reinstall: `cd backend && uv sync`

### Port Already in Use

- Stop conflicting services or change ports in configuration
