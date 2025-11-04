# Test deployment script - mimics GitHub Actions workflow
Write-Host "=== Testing GitHub Pages Deployment ===" -ForegroundColor Green

# Build TypeScript
Write-Host "`n1. Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

# Clean and create docs directory
Write-Host "`n2. Preparing docs directory..." -ForegroundColor Yellow
if (Test-Path "docs") {
    Remove-Item -Recurse -Force "docs"
}
New-Item -ItemType Directory -Path "docs" | Out-Null

# Copy files from src to docs
Write-Host "`n3. Copying files from src to docs..." -ForegroundColor Yellow
Copy-Item -Path "src\*" -Destination "docs\" -Recurse -Force

# Explicitly ensure index.html is at root
Write-Host "`n4. Ensuring index.html is at root..." -ForegroundColor Yellow
Copy-Item -Path "src\index.html" -Destination "docs\index.html" -Force

# Create .nojekyll
Write-Host "`n5. Creating .nojekyll file..." -ForegroundColor Yellow
New-Item -ItemType File -Path "docs\.nojekyll" -Force | Out-Null

# Ensure dist files are included
Write-Host "`n6. Copying dist files..." -ForegroundColor Yellow
if (Test-Path "src\dist") {
    if (-not (Test-Path "docs\dist")) {
        New-Item -ItemType Directory -Path "docs\dist" | Out-Null
    }
    Copy-Item -Path "src\dist\*" -Destination "docs\dist\" -Recurse -Force
}

# Verify structure
Write-Host "`n=== Verifying docs folder structure ===" -ForegroundColor Green
Get-ChildItem -Path "docs" | Select-Object Name, Length, LastWriteTime | Format-Table

Write-Host "`n=== Verifying index.html is at root ===" -ForegroundColor Green
if (Test-Path "docs\index.html") {
    $indexFile = Get-Item "docs\index.html"
    Write-Host "✓ index.html found at: docs\index.html" -ForegroundColor Green
    Write-Host "  Size: $($indexFile.Length) bytes" -ForegroundColor Cyan
    Write-Host "  Modified: $($indexFile.LastWriteTime)" -ForegroundColor Cyan
} else {
    Write-Host "✗ index.html NOT FOUND!" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Key files in docs ===" -ForegroundColor Green
$keyFiles = @("index.html", "style.css", "acwa.js", "acwa-logic.js", "dist\acwa-engine.js", ".nojekyll")
foreach ($file in $keyFiles) {
    $fullPath = Join-Path "docs" $file
    if (Test-Path $fullPath) {
        Write-Host "✓ $file" -ForegroundColor Green
    } else {
        Write-Host "✗ $file MISSING!" -ForegroundColor Red
    }
}

Write-Host "`n=== Deployment test completed successfully! ===" -ForegroundColor Green
Write-Host "You can now test locally with: python -m http.server 8000 --directory docs" -ForegroundColor Cyan
