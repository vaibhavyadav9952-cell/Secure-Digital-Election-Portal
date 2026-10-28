#!/bin/bash
echo "===================================================="
echo " Secure Digital Election Portal - Launcher"
echo "===================================================="
cd "$(dirname "$0")/backend"
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
fi
echo "Starting Election Portal server on http://localhost:5000..."
npm start
