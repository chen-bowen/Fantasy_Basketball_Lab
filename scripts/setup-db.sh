#!/bin/bash
# Script to set up PostgreSQL database for Category Edge

set -e

echo "🔍 Checking PostgreSQL status..."

# Check if PostgreSQL is running
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running"
    echo "📝 Starting PostgreSQL..."
    
    # Try to start PostgreSQL (macOS with Homebrew)
    if command -v brew > /dev/null; then
        brew services start postgresql@14 || brew services start postgresql
    else
        echo "⚠️  Please start PostgreSQL manually"
        exit 1
    fi
    
    # Wait for PostgreSQL to start
    echo "⏳ Waiting for PostgreSQL to start..."
    sleep 3
fi

echo "✅ PostgreSQL is running"

# Check if database exists
if psql -h localhost -U postgres -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw category_edge; then
    echo "✅ Database 'category_edge' already exists"
else
    echo "📝 Creating database 'category_edge'..."
    
    # Try to create database (may need to adjust user)
    psql -h localhost -U postgres -c "CREATE DATABASE category_edge;" 2>&1 || \
    psql -h localhost -U $(whoami) -c "CREATE DATABASE category_edge;" 2>&1 || \
    createdb category_edge 2>&1 || {
        echo "❌ Failed to create database"
        echo "💡 Try running: createdb category_edge"
        exit 1
    }
    
    echo "✅ Database 'category_edge' created"
fi

echo ""
echo "🎉 Database setup complete!"
echo "📝 Next steps:"
echo "   1. Update backend/.env with your DATABASE_URL"
echo "   2. Run migrations: cd backend && uv run alembic upgrade head"




