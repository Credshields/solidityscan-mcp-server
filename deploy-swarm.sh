#!/bin/bash

set -e

STACK_NAME="solidityscan-mcp"
IMAGE_NAME="solidityscan-mcp-server:latest"
STACK_FILE="docker-stack.yml"

echo "🚀 Deploying SolidityScan MCP Server to Docker Swarm"
echo "ℹ️  API keys must be provided per-request via headers, query params, or tool arguments"

# Check if Swarm is initialized
if ! docker info | grep -q "Swarm: active"; then
    echo "⚠️  Swarm not initialized. Initializing..."
    docker swarm init
fi

# Build image
echo "📦 Building Docker image..."
docker build -t $IMAGE_NAME .

# Deploy stack
echo "🚀 Deploying stack..."
docker stack deploy -c $STACK_FILE $STACK_NAME

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 5

# Show status
echo ""
echo "📊 Stack Status:"
docker stack services $STACK_NAME

echo ""
echo "📋 Service Tasks:"
docker stack ps $STACK_NAME

echo ""
echo "✅ Deployment complete!"
echo "🌐 Service available at http://localhost:8080"
echo "🏥 Health check: http://localhost:8080/health"
echo ""
echo "Useful commands:"
echo "  View logs:    docker service logs -f ${STACK_NAME}_solidityscan-mcp"
echo "  Scale:        docker service scale ${STACK_NAME}_solidityscan-mcp=3"
echo "  Remove:       docker stack rm $STACK_NAME"
echo ""
echo "⚠️  Note: API keys must be provided with each request via:"
echo "   - HTTP headers (Authorization, X-API-Key)"
echo "   - Query parameters (?token=...)"
echo "   - Tool arguments (apiToken parameter)"

