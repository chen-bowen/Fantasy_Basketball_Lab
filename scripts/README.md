# Helper Scripts

## Essential Scripts

- **`setup-docker-path.sh`** - Adds Docker to your PATH (run once)
- **`docker-ensure.sh`** - Checks Docker is running, auto-starts if needed
- **`setup-db.sh`** - Sets up PostgreSQL database (manual setup only)

## Usage

```bash
# One-time setup: Add Docker to PATH
./scripts/setup-docker-path.sh
source ~/.zshrc

# Before using Docker: Ensure it's running
./scripts/docker-ensure.sh

# Manual database setup (if not using Docker)
./scripts/setup-db.sh
```



