# Simple test script
Write-Host "Testing if docs/index.html exists..."
if (Test-Path "docs\index.html") {
    $file = Get-Item "docs\index.html"
    Write-Host "✓ index.html found!" -ForegroundColor Green
    Write-Host "Location: $($file.FullName)" -ForegroundColor Cyan
    Write-Host "Size: $($file.Length) bytes" -ForegroundColor Cyan
} else {
    Write-Host "✗ index.html NOT found!" -ForegroundColor Red
}

Write-Host "`nListing files in docs root:" -ForegroundColor Yellow
Get-ChildItem -Path "docs" -File | Select-Object Name | Format-Table -AutoSize

