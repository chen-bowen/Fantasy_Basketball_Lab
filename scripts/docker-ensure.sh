#!/bin/bash
# Quick script to ensure Docker is available and running

set -e

echo "🔍 Checking Docker availability..."

# Add common Docker paths to PATH
export PATH="/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Check if docker command exists
if ! command -v docker > /dev/null 2>&1; then
    echo "❌ Docker command not found"
    echo ""
    echo "📝 Please install Docker Desktop:"
    echo "   brew install --cask docker"
    echo "   OR download from: https://www.docker.com/products/docker-desktop/"
    echo ""
    echo "   Then open Docker Desktop from Applications"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info > /dev/null 2>&1; then
    echo "⚠️  Docker Desktop is not running"
    echo ""
    echo "🚀 Attempting to start Docker Desktop..."
    
    # Try to open Docker Desktop
    if [ -d "/Applications/Docker.app" ]; then
        open -a Docker
        echo "⏳ Waiting for Docker to start (this may take 30-60 seconds)..."
        
        # Wait up to 60 seconds for Docker to start
        for i in {1..60}; do
            if docker info > /dev/null 2>&1; then
                echo "✅ Docker is now running!"
                break
            fi
            sleep 1
            echo -n "."
        done
        echo ""
        
        if ! docker info > /dev/null 2>&1; then
            echo "❌ Docker did not start. Please open Docker Desktop manually."
            exit 1
        fi
    else
        echo "❌ Docker Desktop not found in Applications"
        echo "Please install Docker Desktop first"
        exit 1
    fi
fi

echo "✅ Docker is available and running"
docker --version
docker compose version 2>/dev/null || docker-compose --version || echo "⚠️  Docker Compose not found"



