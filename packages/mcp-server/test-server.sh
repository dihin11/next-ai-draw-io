#!/bin/bash

echo "Testing Next AI Draw.io MCP Server..."
echo "======================================"
echo ""

# Test 1: Health check
echo "Test 1: Health check"
curl -s http://localhost:6005/health
echo ""
echo ""

# Test 2: Server info
echo "Test 2: Server info"
curl -s http://localhost:6005/
echo ""
echo ""

# Test 3: Create session
echo "Test 3: Create session"
curl -s -X POST http://localhost:6005/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "start_session",
      "arguments": {}
    }
  }'
echo ""
echo ""

# Test 4: List tools
echo "Test 4: List available tools"
curl -s -X POST http://localhost:6005/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
echo ""
echo ""

echo "======================================"
echo "Test completed!"
