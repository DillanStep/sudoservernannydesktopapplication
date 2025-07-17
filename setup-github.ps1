# GitHub Setup Script for DayZ Server Manager
Write-Host "Setting up GitHub integration for DayZ Server Manager..." -ForegroundColor Green
Write-Host ""

# Check if git is installed
try {
    $gitVersion = git --version
    Write-Host "✓ Git is installed: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Git is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Git from https://git-scm.com/download/win" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# Get user input
$githubUser = Read-Host "Enter your GitHub username"
$repoName = Read-Host "Enter repository name (default: dayz-server-manager)"
if ([string]::IsNullOrEmpty($repoName)) {
    $repoName = "dayz-server-manager"
}

Write-Host ""
Write-Host "Setting up repository: $githubUser/$repoName" -ForegroundColor Cyan
Write-Host ""

# Update files with repository information
Write-Host "Updating package.json with repository information..." -ForegroundColor Yellow

$packageJson = Get-Content 'package.json' -Raw
$packageJson = $packageJson -replace 'your-username', $githubUser
$packageJson | Set-Content 'package.json'

$readme = Get-Content 'README.md' -Raw
$readme = $readme -replace 'your-username', $githubUser
$readme | Set-Content 'README.md'

$changelog = Get-Content 'CHANGELOG.md' -Raw
$changelog = $changelog -replace 'your-username', $githubUser
$changelog | Set-Content 'CHANGELOG.md'

Write-Host "✓ Repository information updated!" -ForegroundColor Green
Write-Host ""

# Initialize git repository
if (-not (Test-Path ".git")) {
    Write-Host "Initializing git repository..." -ForegroundColor Yellow
    git init
    git branch -M main
} else {
    Write-Host "✓ Git repository already exists." -ForegroundColor Green
}

# Add all files
Write-Host "Adding files to git..." -ForegroundColor Yellow
git add .

# Create initial commit
Write-Host "Creating initial commit..." -ForegroundColor Yellow
git commit -m "Initial commit with auto-updater system"

# Add remote origin
Write-Host "Adding GitHub remote..." -ForegroundColor Yellow
git remote remove origin 2>$null
git remote add origin "https://github.com/$githubUser/$repoName.git"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "Setup complete! Next steps:" -ForegroundColor Green
Write-Host ""
Write-Host "1. Create the repository on GitHub:" -ForegroundColor Cyan
Write-Host "   https://github.com/new" -ForegroundColor White
Write-Host "   Repository name: $repoName" -ForegroundColor White
Write-Host "   Make it PUBLIC for auto-updates to work" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Push to GitHub:" -ForegroundColor Cyan
Write-Host "   git push -u origin main" -ForegroundColor White
Write-Host ""
Write-Host "3. To release a new version:" -ForegroundColor Cyan
Write-Host "   npm run release" -ForegroundColor White
Write-Host ""
Write-Host "4. GitHub Actions will automatically build" -ForegroundColor Cyan
Write-Host "   and create releases for auto-updates." -ForegroundColor White
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

Read-Host "Press Enter to continue"
