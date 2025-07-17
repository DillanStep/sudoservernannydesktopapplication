@echo off
echo Setting up GitHub integration for DayZ Server Manager...
echo.

REM Check if git is installed
git --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed or not in PATH.
    echo Please install Git from https://git-scm.com/download/win
    pause
    exit /b 1
)

echo Git is installed. Proceeding with setup...
echo.

REM Get user input for GitHub repository
set /p GITHUB_USER="Enter your GitHub username: "
set /p REPO_NAME="Enter repository name (default: dayz-server-manager): "
if "%REPO_NAME%"=="" set REPO_NAME=dayz-server-manager

echo.
echo Setting up repository: %GITHUB_USER%/%REPO_NAME%
echo.

REM Update package.json with correct repository information
echo Updating package.json with repository information...
powershell -Command "(Get-Content 'package.json') -replace 'your-username', '%GITHUB_USER%' | Set-Content 'package.json'"
powershell -Command "(Get-Content 'README.md') -replace 'your-username', '%GITHUB_USER%' | Set-Content 'README.md'"
powershell -Command "(Get-Content 'CHANGELOG.md') -replace 'your-username', '%GITHUB_USER%' | Set-Content 'CHANGELOG.md'"

echo Repository information updated!
echo.

REM Initialize git repository
if not exist ".git" (
    echo Initializing git repository...
    git init
    git branch -M main
) else (
    echo Git repository already exists.
)

REM Add all files
echo Adding files to git...
git add .

REM Create initial commit
echo Creating initial commit...
git commit -m "Initial commit with auto-updater system"

REM Add remote origin
echo Adding GitHub remote...
git remote remove origin 2>nul
git remote add origin https://github.com/%GITHUB_USER%/%REPO_NAME%.git

echo.
echo ============================================
echo Setup complete! Next steps:
echo.
echo 1. Create the repository on GitHub:
echo    https://github.com/new
echo    Repository name: %REPO_NAME%
echo    Make it PUBLIC for auto-updates to work
echo.
echo 2. Push to GitHub:
echo    git push -u origin main
echo.
echo 3. To release a new version:
echo    npm run release
echo.
echo 4. GitHub Actions will automatically build
echo    and create releases for auto-updates.
echo ============================================
echo.
pause
