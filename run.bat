@echo off
echo ====================================================
echo  Secure Digital Election Portal - Launcher
echo ====================================================
cd backend
if not exist node_modules (
    echo Installing backend dependencies...
    npm install
)
echo Starting Election Portal server...
start http://localhost:5000
npm start
pause
