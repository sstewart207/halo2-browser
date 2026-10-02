param(
    [string]$OutFile = "cfg_export.json",
    [int]$MaxFunctions = 100
)

$ErrorActionPreference = "Stop"

$ghidraHeadless = "C:\Users\sstew\Downloads\ghidra_12.1.4_PUBLIC_20260921\ghidra_12.1.4_PUBLIC\support\analyzeHeadless.bat"
$scriptDir = Resolve-Path "$PSScriptRoot\..\..\halo2-browser\scratch\ghidra"
$projDir = "$scriptDir\proj"

if (-not (Test-Path $ghidraHeadless)) {
    Write-Error "Ghidra analyzeHeadless not found at $ghidraHeadless"
}

Write-Host "Running Ghidra Headless CFG Extraction..."
Write-Host "  Project: $projDir\halo2"
Write-Host "  Script:  $scriptDir\ExportFunctionCFG.java"
Write-Host "  Output:  $OutFile"
Write-Host "  Limit:   $MaxFunctions functions"

& $ghidraHeadless $projDir halo2 -process halo2.exe -noanalysis -scriptPath $scriptDir -postScript ExportFunctionCFG.java $OutFile $MaxFunctions

if ($LASTEXITCODE -eq 0) {
    Write-Host "Ghidra CFG extraction succeeded! Output written to $OutFile" -ForegroundColor Green
} else {
    Write-Error "Ghidra CFG extraction failed with exit code $LASTEXITCODE"
}
