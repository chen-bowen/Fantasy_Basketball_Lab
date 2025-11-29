#!/bin/bash
# Script to ensure Docker is available in PATH

set -e

SHELL_CONFIG=""
if [ -n "$ZSH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.bash_profile"
    [ -f "$HOME/.bashrc" ] && SHELL_CONFIG="$HOME/.bashrc"
fi

if [ -z "$SHELL_CONFIG" ]; then
    echo "⚠️  Could not detect shell configuration file"
    echo "Please manually add Docker to your PATH"
    exit 1
fi

echo "📝 Setting up Docker in PATH for $SHELL_CONFIG"

# Docker Desktop paths on macOS
DOCKER_PATHS=(
    "/usr/local/bin"
    "/Applications/Docker.app/Contents/Resources/bin"
)

# Check if docker is already in PATH
if command -v docker > /dev/null 2>&1; then
    echo "✅ Docker is already available in PATH"
    docker --version
    exit 0
fi

# Create a function that ensures Docker Desktop is running and provides docker
DOCKER_FUNCTION='
# Ensure Docker Desktop is available
if ! command -v docker > /dev/null 2>&1; then
    # Add Docker Desktop paths if they exist
    for docker_path in "/usr/local/bin" "/Applications/Docker.app/Contents/Resources/bin"; do
        if [ -d "$docker_path" ] && [[ ":$PATH:" != *":$docker_path:"* ]]; then
            export PATH="$docker_path:$PATH"
        fi
    done
    
    # If still not found, provide helpful error
    if ! command -v docker > /dev/null 2>&1; then
        docker() {
            echo "❌ Docker is not available. Please:" >&2
            echo "   1. Install Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
            echo "   2. Open Docker Desktop from Applications" >&2
            echo "   3. Wait for Docker to start (whale icon in menu bar)" >&2
            return 1
        }
    fi
fi
'

# Check if the function already exists
if grep -q "Ensure Docker Desktop is available" "$SHELL_CONFIG" 2>/dev/null; then
    echo "✅ Docker PATH setup already exists in $SHELL_CONFIG"
else
    echo "" >> "$SHELL_CONFIG"
    echo "# Docker Desktop PATH setup (added by Category Edge setup)" >> "$SHELL_CONFIG"
    echo "$DOCKER_FUNCTION" >> "$SHELL_CONFIG"
    echo "✅ Added Docker PATH setup to $SHELL_CONFIG"
    echo ""
    echo "📝 To apply changes, run:"
    echo "   source $SHELL_CONFIG"
    echo ""
    echo "Or open a new terminal window"
fi



